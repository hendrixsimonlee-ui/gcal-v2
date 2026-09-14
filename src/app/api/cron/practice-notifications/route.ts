import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  notifyAttendanceDue,
  notifyCheckInOpen,
  notifyConflictsDue,
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

  const conflictsNudged = await runConflictNudge(now);

  return NextResponse.json({
    soonSent,
    checkInSent,
    attendanceSent,
    conflictsNudged,
    checkedAt: now.toISOString(),
  });
}

/** The weekly "your conflicts aren't in yet" nudge, at the day and time the
 * AD picked in Settings.
 *
 * It nudges about the week starting the following Monday — the one the AD is
 * about to build — and only the people who haven't submitted for it. If
 * everybody has, nobody is messaged.
 *
 * Off unless the AD turns it on: this is the only message in the app that
 * arrives without them pressing anything. */
async function runConflictNudge(now: Date): Promise<number> {
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

  // Eastern, like everything else — the AD picks "Thursday 6pm" and means
  // their own clock, not the server's.
  const here = zonedParts(now);
  if (here.weekday !== settings.conflictNudgeWeekday) return 0;

  const dueMinutes = settings.conflictNudgeHour * 60 + settings.conflictNudgeMinute;
  const nowMinutes = here.hour * 60 + here.minute;
  // Same window as everything else here: the job runs every five minutes, so
  // it has to catch the tick it lands on rather than an exact minute.
  if (nowMinutes < dueMinutes || nowMinutes > dueMinutes + LOOKBACK_MINUTES) {
    return 0;
  }

  const weekOf = addDays(startOfWeek(now), 7);

  // Once a week, whatever happens. The notification rows are the record, same
  // as the per-practice ones — no extra column to get out of step.
  const already = await prisma.notification.findFirst({
    where: {
      type: "CONFLICTS_DUE",
      createdAt: { gte: addDays(now, -3) },
      message: { contains: formatWeekLabel(weekOf) },
    },
    select: { id: true },
  });
  if (already) return 0;

  const submitted = await prisma.conflictSubmission.findMany({
    where: { weekOf, submittedAt: { not: null } },
    select: { userId: true },
  });
  const done = new Set(submitted.map((s) => s.userId));

  const roster = await prisma.user.findMany({ select: { id: true } });
  const missing = roster.map((u) => u.id).filter((id) => !done.has(id));
  if (missing.length === 0) return 0;

  return notifyConflictsDue(missing, formatWeekLabel(weekOf));
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
