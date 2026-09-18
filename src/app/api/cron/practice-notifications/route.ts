import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  notifyAttendanceDue,
  notifyCheckInOpen,
  notifyConflictsDue,
  notifyConflictsDueSoon,
  CONFLICTS_DUE_NOW_PREFIX,
  CONFLICTS_DUE_SOON_PREFIX,
  notifyPracticeStartingSoon,
} from "@/lib/notify";
import { settleAttendance } from "@/lib/actions/attendance";
import { addDays, formatWeekLabel, startOfWeek } from "@/lib/dates";
import { zonedParts } from "@/lib/timezone";

/** How far back to look for practices that have just started or just ended.
 * Comfortably wider than the every-5-minutes schedule, because each
 * notification type is de-duplicated by its own notification rows rather
 * than by timing. */
const LOOKBACK_MINUTES = 15;

/** How far ahead of the deadline the heads-up goes out.
 *
 * Two hours, because a reminder that lands *at* the deadline arrives when
 * there is nothing useful left to do about it. This is measured back from
 * whatever time the AD set, so moving the deadline moves both messages and
 * they can't drift apart. */
const HEADS_UP_MINUTES = 120;

/** How far ahead the "starts soon" nudge looks.
 *
 * The window is 15 to 20 minutes out rather than exactly 15, because the job
 * runs every five minutes and an exact match would miss most practices
 * entirely. Anything in the window gets one notification and the
 * de-duplication stops a second. */
const STARTING_SOON_MIN = 15;
const STARTING_SOON_MAX = 20;

/** Fires everything that happens on a clock rather than because the AD
 * pressed something:
 *
 * - "starts in 15 minutes", to the cast
 * - "practice started, check in", to the cast
 * - "confirm attendance", to the choreographers, when it ends
 * - the weekly conflicts nudge, at the day and time the AD set
 *
 * A web app can't wake itself up, so this is driven by a scheduled request
 * (see DEPLOYMENT.md). Safe to call as often as you like — each notification
 * is sent once per practice, checked against the notification rows
 * themselves. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  // Fail closed in production. This used to be `if (secret)`, which meant a
  // missing or misspelled variable left the endpoint open to anyone who knew
  // the URL — a misconfiguration should stop the notifications, not quietly
  // unlock the door.
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("CRON_SECRET is not set", { status: 503 });
    }
  } else if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_MINUTES * 60_000);

  const [startingSoon, justStarted, justEnded] = await Promise.all([
    prisma.practice.findMany({
      where: {
        status: "CONFIRMED",
        startDateTime: {
          gte: new Date(now.getTime() + STARTING_SOON_MIN * 60_000),
          lte: new Date(now.getTime() + STARTING_SOON_MAX * 60_000),
        },
        dance: { archivedAt: null },
      },
      select: { id: true, danceId: true },
    }),
    prisma.practice.findMany({
      where: {
        status: "CONFIRMED",
        startDateTime: { gte: since, lte: now },
        dance: { archivedAt: null },
      },
      select: { id: true, danceId: true },
    }),
    prisma.practice.findMany({
      where: {
        status: "CONFIRMED",
        endDateTime: { gte: since, lte: now },
        dance: { archivedAt: null },
      },
      select: { id: true, danceId: true },
    }),
  ]);

  let soonSent = 0;
  for (const practice of startingSoon) {
    if (await alreadySent(practice.id, "REMINDER")) continue;
    await notifyPracticeStartingSoon(practice.id);
    soonSent++;
  }

  let checkInSent = 0;
  for (const practice of justStarted) {
    if (await alreadySent(practice.id, "CHECK_IN_OPEN")) continue;
    await notifyCheckInOpen(practice.id);
    checkInSent++;
  }

  let attendanceSent = 0;
  for (const practice of justEnded) {
    if (await alreadySent(practice.id, "ATTENDANCE_DUE")) continue;
    // Fill in everyone who never checked in first, so the recap the
    // choreographer opens is already complete rather than half-empty.
    await settleAttendance(practice.id);
    await notifyAttendanceDue(practice.id);
    attendanceSent++;
  }

  const conflictsNudged = await runConflictReminders(now);

  return NextResponse.json({
    soonSent,
    checkInSent,
    attendanceSent,
    conflictsNudged,
    checkedAt: now.toISOString(),
  });
}

/** The conflicts deadline, in two messages.
 *
 * The AD sets one time in Settings: when conflicts are due. Two things hang
 * off it, both only to the people who haven't submitted for the week the AD
 * is about to build:
 *
 * - **Two hours before**, a heads-up, while there is still time to act on it.
 * - **At the deadline**, the urgent one, naming the two presses that matter.
 *
 * Deriving the first from the second is the point. A second configurable time
 * would be one more thing to set and one more thing to leave stale when the
 * deadline moves.
 *
 * Off unless the AD turns it on: these are the only messages in the app that
 * arrive without somebody pressing something. */
async function runConflictReminders(now: Date): Promise<number> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: "singleton" },
    select: {
      conflictNudgeEnabled: true,
      conflictNudgeWeekday: true,
      conflictNudgeHour: true,
      conflictNudgeMinute: true,
    },
  });
  if (!settings?.conflictNudgeEnabled) return 0;

  // Eastern, like everything else. The AD picks "Thursday noon" and means
  // their own clock, not the server's.
  const here = zonedParts(now);
  const nowMinutes = here.hour * 60 + here.minute;
  const dueMinutes =
    settings.conflictNudgeHour * 60 + settings.conflictNudgeMinute;

  // The job runs every five minutes, so each message has to catch the tick it
  // lands on rather than an exact minute.
  const landsOn = (weekday: number, minutes: number) =>
    here.weekday === weekday &&
    nowMinutes >= minutes &&
    nowMinutes <= minutes + LOOKBACK_MINUTES;

  let sent = 0;

  if (landsOn(settings.conflictNudgeWeekday, dueMinutes)) {
    sent += await fireConflictReminder(
      now,
      0,
      CONFLICTS_DUE_NOW_PREFIX,
      notifyConflictsDue,
    );
  }

  // Two hours earlier, which can fall on the previous day if the AD set a
  // deadline before 2am. Rare, but a wrapped time would otherwise silently
  // never fire.
  let soonMinutes = dueMinutes - HEADS_UP_MINUTES;
  let soonWeekday = settings.conflictNudgeWeekday;
  let dayShift = 0;
  if (soonMinutes < 0) {
    soonMinutes += 24 * 60;
    soonWeekday = (soonWeekday + 6) % 7;
    dayShift = 1;
  }

  if (landsOn(soonWeekday, soonMinutes)) {
    sent += await fireConflictReminder(
      now,
      dayShift,
      CONFLICTS_DUE_SOON_PREFIX,
      notifyConflictsDueSoon,
    );
  }

  return sent;
}

/** Sends one of the two, if it hasn't already gone out for this week.
 *
 * `dayShift` moves the anchor forward when the heads-up falls the day before
 * the deadline, so both messages talk about the same week.
 *
 * De-duplication is on the notification rows themselves, same as the
 * per-practice ones, so there is no extra column to get out of step. The two
 * messages share a type and are told apart by how they open — which is why
 * those openings are exported constants rather than typed out twice. */
async function fireConflictReminder(
  now: Date,
  dayShift: number,
  prefix: string,
  send: (userIds: string[], weekLabel: string) => Promise<number>,
): Promise<number> {
  const anchor = dayShift === 0 ? now : addDays(now, dayShift);
  const weekOf = addDays(startOfWeek(anchor), 7);
  const label = formatWeekLabel(weekOf);

  // A week the AD has switched off, such as a break. Nobody needs chasing
  // about conflicts for a week the troupe isn't rehearsing.
  const skipped = await prisma.conflictReminderSkip.findUnique({
    where: { weekOf },
    select: { weekOf: true },
  });
  if (skipped) return 0;

  const already = await prisma.notification.findFirst({
    where: {
      type: "CONFLICTS_DUE",
      createdAt: { gte: addDays(now, -3) },
      message: { startsWith: prefix, contains: label },
    },
    select: { id: true },
  });
  if (already) return 0;

  const submitted = await prisma.conflictSubmission.findMany({
    where: { weekOf, submittedAt: { not: null } },
    select: { userId: true },
  });
  const done = new Set(submitted.map((sub) => sub.userId));

  const roster = await prisma.user.findMany({ select: { id: true } });
  const missing = roster.map((u) => u.id).filter((id) => !done.has(id));
  if (missing.length === 0) return 0;

  return send(missing, label);
}

/** De-duplication without a "notified" column: the notification rows carry
 * the practice's link, so their existence is the record that it went out. */
async function alreadySent(
  practiceId: string,
  type: "CHECK_IN_OPEN" | "ATTENDANCE_DUE" | "REMINDER",
): Promise<boolean> {
  if (type === "ATTENDANCE_DUE") {
    const existing = await prisma.notification.findFirst({
      where: { type, href: `/attendance/${practiceId}` },
      select: { id: true },
    });
    return existing !== null;
  }

  // The other two both point at "/schedule", which isn't unique to one
  // practice, so they match on the message — which names the dance and can
  // only have been written for this one — and on the practice's own start
  // time, so last week's message can't suppress this week's.
  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    select: { dance: { select: { name: true } }, startDateTime: true },
  });
  if (!practice) return true;

  const phrase =
    type === "REMINDER"
      ? `${practice.dance.name} starts in 15 minutes`
      : `${practice.dance.name} has started`;

  const existing = await prisma.notification.findFirst({
    where: {
      type,
      message: { startsWith: phrase },
      // A "starts soon" message is written before the practice begins, so the
      // floor has to be earlier than the start or it would never match itself.
      createdAt: { gte: new Date(practice.startDateTime.getTime() - 60 * 60_000) },
    },
    select: { id: true },
  });
  return existing !== null;
}
