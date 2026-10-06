"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  requireAdmin,
  requireChoreographerOrAdmin,
  requireUser,
} from "@/lib/authz";
import {
  computeMinutesLate,
  effectivePracticeStart,
  statusForNoCheckIn,
  statusForOutcome,
  statusFromCheckIn,
  type AttendanceOutcome,
  type AttendanceStatus,
} from "@/lib/attendance";
import { formatWeekLabel, startOfWeek } from "@/lib/dates";
import {
  DEFAULT_FEE_TIERS,
  calculateLateFee,
  formatMoney,
  type FeeTier,
} from "@/lib/attendance-fees";
import { APP_TIME_ZONE } from "@/lib/timezone";

const SETTINGS_ID = "singleton";

/** Prefix on the automatic flag raised when somebody other than the AD moves
 * a practice's start time. It is what lets the next change replace the last
 * one instead of stacking another entry on the queue, so keep it stable. */
const START_TIME_FLAG = "Start time changed: ";

/** Eastern, and the way a person writes a time — the flag is read by the AD,
 * not typed into a form, so "3:10 PM" rather than "15:10". */
const flagClock = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

export async function getAttendanceSettings() {
  const existing = await prisma.appSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  if (existing) return existing;

  // First read creates the row with schema defaults, so the AD always has
  // something concrete to edit on the Settings screen.
  return prisma.appSettings.create({ data: { id: SETTINGS_ID } });
}

export async function updateAttendanceSettings(formData: FormData) {
  await requireAdmin();
  const threshold = Number(formData.get("chronicAbsenceThreshold"));
  const window = Number(formData.get("chronicAbsenceWindow"));
  const lateThreshold = Number(formData.get("lateThresholdMinutes"));

  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error("Threshold must be a whole number of 1 or more");
  }
  if (!Number.isInteger(window) || window < 1) {
    throw new Error("Window must be a whole number of 1 or more");
  }
  if (threshold > window) {
    throw new Error(
      "Threshold can't be larger than the window — nobody could ever be flagged",
    );
  }
  if (!Number.isInteger(lateThreshold) || lateThreshold < 0) {
    throw new Error("Late threshold must be 0 or more minutes");
  }

  const useHistoricalWeighting = formData.get("useHistoricalWeighting") === "on";

  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {
      chronicAbsenceThreshold: threshold,
      chronicAbsenceWindow: window,
      lateThresholdMinutes: lateThreshold,
      useHistoricalWeighting,
    },
    create: {
      id: SETTINGS_ID,
      chronicAbsenceThreshold: threshold,
      chronicAbsenceWindow: window,
      lateThresholdMinutes: lateThreshold,
      useHistoricalWeighting,
    },
  });
  revalidatePath("/admin/settings");
  revalidatePath("/admin/attendance");
  revalidatePath("/admin/schedule-builder");
}

export interface CheckInWindow {
  practiceId: string;
  danceName: string;
  spaceName: string | null;
  startDateTime: Date;
  endDateTime: Date;
  /** Their agreed arrival time, if they have one. */
  plannedArriveAt: Date | null;
  alreadyCheckedInAt: Date | null;
  minutesLate: number | null;
  /** Where the app currently has them: excused from this one, down as not
   * coming, or simply expected. Checking in overrides all three. */
  standing: "EXPECTED" | "EXCUSED" | "NOT_COMING";
}

/** Where the app has somebody for a practice, before they check in.
 *
 * A conflict the AD excused means they were told they didn't have to come. An
 * unreviewed or refused one still means the app expects them to be missing,
 * but nobody has blessed it. Neither stops them turning up. */
function standingFor(
  userId: string,
  start: Date,
  end: Date,
  conflicts: { userId: string; startDateTime: Date; endDateTime: Date; status: string }[],
): "EXPECTED" | "EXCUSED" | "NOT_COMING" {
  const overlapping = conflicts.filter(
    (c) => c.userId === userId && c.startDateTime < end && start < c.endDateTime,
  );
  if (overlapping.length === 0) return "EXPECTED";
  return overlapping.some((c) => c.status === "EXCUSED") ? "EXCUSED" : "NOT_COMING";
}

/** Was this person excused from this practice by the AD?
 *
 * Only an excused conflict counts. One nobody has reviewed is not permission,
 * and treating it as permission would make "log a conflict, then turn up late"
 * a way to arrive free. */
async function wasExcusedFrom(
  userId: string,
  start: Date,
  end: Date,
): Promise<boolean> {
  const excused = await prisma.conflict.findFirst({
    where: {
      userId,
      status: "EXCUSED",
      startDateTime: { lt: end },
      endDateTime: { gt: start },
    },
    select: { id: true },
  });
  return excused !== null;
}

/** Practices the signed-in person can check into right now.
 *
 * The window is exactly the practice: it opens when the practice starts and
 * closes when it's slated to end. Anyone the app already knows isn't coming —
 * out of town, or any logged conflict over the practice — isn't asked. */
export async function getOpenCheckIns(): Promise<CheckInWindow[]> {
  const user = await requireUser();
  const now = new Date();

  const practices = await prisma.practice.findMany({
    where: {
      status: "CONFIRMED",
      startDateTime: { lte: now },
      endDateTime: { gte: now },
      dance: {
        archivedAt: null,
        memberships: { some: { userId: user.id } },
      },
    },
    include: {
      space: { select: { name: true } },
      dance: { select: { name: true } },
      attendance: { where: { userId: user.id } },
      plannedArrivals: { where: { userId: user.id } },
    },
    orderBy: { startDateTime: "asc" },
  });
  if (practices.length === 0) return [];

  const [conflicts] = await Promise.all([
    prisma.conflict.findMany({ where: { userId: user.id } }),
  ]);

  // Everybody in the cast sees the button, including people the app already
  // knows aren't coming.
  //
  // It used to hide itself from anyone with a conflict over the practice,
  // which was tidy and wrong: plans change, and somebody whose class finished
  // early and walked over had no way to say so. They were marked absent for a
  // rehearsal they attended. The button costs nothing to show, and pressing it
  // is the person telling us something true.
  return practices.map((p) => ({
    practiceId: p.id,
    danceName: p.dance.name,
    spaceName: p.space?.name ?? null,
    startDateTime: p.startDateTime,
    endDateTime: p.endDateTime,
    plannedArriveAt: p.plannedArrivals[0]?.arriveAt ?? null,
    alreadyCheckedInAt: p.attendance[0]?.checkedInAt ?? null,
    minutesLate: p.attendance[0]?.minutesLate ?? null,
    // So the card can say where they stand rather than just offering a button
    // to somebody who believes they're excused.
    standing: standingFor(user.id, p.startDateTime, p.endDateTime, conflicts),
  }));
}

export interface CheckInResult {
  minutesLate: number;
  status: AttendanceStatus;
}

/** "I'm here." Records the moment and works out how late that was. */
export async function checkIn(practiceId: string): Promise<CheckInResult> {
  const user = await requireUser();
  const now = new Date();

  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    include: {
      dance: { include: { memberships: { where: { userId: user.id } } } },
      plannedArrivals: { where: { userId: user.id } },
    },
  });

  if (practice.dance.memberships.length === 0) {
    throw new Error("You're not in this dance");
  }
  if (now < practice.startDateTime) {
    throw new Error("Check-in opens when the practice starts");
  }
  if (now > practice.endDateTime) {
    throw new Error(
      "Check-in for this practice has closed — ask your choreographer to mark you in",
    );
  }

  const settings = await getAttendanceSettings();
  const start = effectivePracticeStart(
    practice.startDateTime,
    practice.actualStartTime,
  );
  const measured = computeMinutesLate(
    now,
    start,
    practice.plannedArrivals[0]?.arriveAt ?? null,
  );

  // Were they already excused from this one? Then turning up is a bonus and
  // costs nothing. Somebody with permission to miss a rehearsal entirely must
  // never end up worse off for coming than for staying home — that would be
  // the app charging people for doing the thing it wants.
  const excused = await wasExcusedFrom(
    user.id,
    practice.startDateTime,
    practice.endDateTime,
  );
  const minutesLate = excused ? 0 : measured;
  const status = statusFromCheckIn(minutesLate, settings.lateThresholdMinutes);

  await prisma.attendance.upsert({
    where: { practiceId_userId: { practiceId, userId: user.id } },
    update: {
      status,
      checkedInAt: now,
      minutesLate,
      measuredMinutesLate: measured,
      cameDespiteExcusal: excused,
      isOverride: false,
      // A fresh check-in supersedes any hand-set figure: they have just told
      // us when they actually walked in.
      lateMinutesSetById: null,
      lateMinutesSetAt: null,
    },
    create: {
      practiceId,
      userId: user.id,
      status,
      checkedInAt: now,
      minutesLate,
      measuredMinutesLate: measured,
      cameDespiteExcusal: excused,
    },
  });

  // The AD asked to be told when this happens rather than have it pass
  // silently, so it lands in their queue as a flag nobody had to raise.
  if (excused) {
    await prisma.attendanceFlag.create({
      data: {
        practiceId,
        subjectUserId: user.id,
        raisedById: user.id,
        isAutomatic: true,
        body:
          measured > 0
            ? `Was excused but came anyway, ${measured} minutes in. Not charged.`
            : "Was excused but came anyway. Not charged.",
      },
    });
  }

  revalidatePath("/schedule");
  revalidatePath("/my-attendance");
  revalidatePath(`/attendance/${practiceId}`);
  revalidatePath("/admin/attendance");
  return { minutesLate, status };
}

/** Fills in everyone who never checked in, so a practice's record is complete
 * rather than partial. Safe to run repeatedly — it only writes rows that
 * don't exist yet, so it never overwrites a check-in or an override. */
export async function settleAttendance(practiceId: string): Promise<number> {
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    include: {
      dance: { include: { memberships: { select: { userId: true } } } },
      attendance: { select: { userId: true } },
    },
  });


  const castUserIds = practice.dance.memberships.map((m) => m.userId);
  const recorded = new Set(practice.attendance.map((a) => a.userId));
  const missing = castUserIds.filter((id) => !recorded.has(id));
  if (missing.length === 0) return 0;

  const [conflicts, exclusions] = await Promise.all([
    prisma.conflict.findMany({ where: { userId: { in: missing } } }),
    // Anyone the AD took out of this dance's week can't be marked down for
    // not turning up to it. The app removed them from the scheduling that
    // produced this practice; holding it against them afterwards would be the
    // app penalising its own decision.
    prisma.weeklyExclusion.findMany({
      where: {
        userId: { in: missing },
        danceId: practice.danceId,
        weekOf: startOfWeek(practice.startDateTime),
      },
      select: { userId: true },
    }),
  ]);
  const excluded = new Set(exclusions.map((e) => e.userId));

  await prisma.attendance.createMany({
    data: missing.map((userId) => ({
      practiceId,
      userId,
      status: excluded.has(userId)
        ? ("EXCUSED_ABSENT" as AttendanceStatus)
        : statusForNoCheckIn(
            userId,
            practice.startDateTime,
            practice.endDateTime,
            conflicts,
          ),
    })),
    skipDuplicates: true,
  });

  return missing.length;
}

/** Throws if the AD has ticked this practice's week off as reviewed.
 *
 * The tick is the AD's own tracking — "I've been through this week" — and its
 * job is to stop the record moving under them afterwards. It's never a dead
 * end: reopening the week from the archive is one click. */
async function assertWeekOpen(startDateTime: Date) {
  const review = await prisma.attendanceWeekReview.findUnique({
    where: { weekOf: startOfWeek(startDateTime) },
    select: { id: true },
  });
  if (review) {
    throw new Error(
      "That week has been reviewed and locked. Reopen it on Attendance Review to make changes.",
    );
  }
}

/** Recording that somebody came, or didn't, and why.
 *
 * This replaced an action that took a status — PRESENT, LATE, EXCUSED_ABSENT,
 * UNEXCUSED_ABSENT — and wrote it straight down. That was the bug. Setting
 * PRESENT also wrote `minutesLate = 0`, so marking somebody "here" deleted the
 * fourteen minutes they had been late by and the fee with them; setting LATE
 * left the minutes at zero, so nothing was ever charged. The two fields could
 * disagree, and whichever was written last won.
 *
 * Now there are three outcomes and none of them is "late", because late isn't
 * a decision anybody makes — it is what the minutes say. **This function never
 * writes `minutesLate`.** Changing how late somebody was is `setMinutesLate`
 * in the dues actions, which is the AD's alone and re-prices the charge.
 *
 * That split is the whole fix, and it is why choreographers keep the dropdown.
 * Taking it away as well — flag it, wait for the AD, have them approve it —
 * made a person running a rehearsal file a request to write down who was in
 * the room, which is the one thing they are actually there to know. The money
 * was never theirs to move and now it isn't reachable from here by anybody;
 * the sheet is theirs and goes back to being theirs.
 *
 * Who may call it: anyone who runs the dance, and the AD. Before submitting
 * and after — a name remembered on the walk home is still worth correcting,
 * and the alternative is a sheet everybody knows is wrong. Changes after
 * submission are marked as overrides and carry who made them, so the AD's
 * review shows the correction rather than hiding it. The only door this
 * closes is a reviewed week, which `assertWeekOpen` holds shut for everyone
 * until the AD reopens it.
 */
export async function markAttendance(
  practiceId: string,
  userId: string,
  outcome: AttendanceOutcome,
) {
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { danceId: true, startDateTime: true },
  });
  const marker = await requireChoreographerOrAdmin(practice.danceId);
  await assertWeekOpen(practice.startDateTime);

  const existing = await prisma.attendance.findUnique({
    where: { practiceId_userId: { practiceId, userId } },
    select: { checkedInAt: true, minutesLate: true },
  });

  const settings = await getAttendanceSettings();
  const status = statusForOutcome(
    outcome,
    existing?.minutesLate ?? null,
    settings.lateThresholdMinutes,
  );

  await prisma.attendance.upsert({
    where: { practiceId_userId: { practiceId, userId } },
    update: {
      status,
      isOverride: true,
      markedById: marker.id,
      markedAt: new Date(),
      // Deliberately absent: minutesLate. Saying somebody came says nothing
      // about when, and guessing zero is exactly what deleted the charges.
    },
    create: {
      practiceId,
      userId,
      status,
      isOverride: true,
      markedById: marker.id,
    },
  });

  revalidatePath(`/attendance/${practiceId}`);
  revalidatePath("/my-attendance");
  revalidatePath("/admin/attendance");
}

/** The fee ladder that was in force on a given day.
 *
 * The ledger does this too, for the ledger's own reasons. It is three lines
 * and reading the schedules here keeps this file from importing a server
 * action, which is the trade: a practice older than every schedule keeps the
 * oldest one rather than becoming free, and a database with no schedules at
 * all falls back to the ladder shipped in the code. "Everything is suddenly
 * free" is a much worse failure than "the rates are the ones we started
 * with". */
async function ladderOn(when: Date): Promise<readonly FeeTier[]> {
  const schedules = await prisma.feeSchedule.findMany({
    orderBy: { effectiveFrom: "desc" },
    select: {
      effectiveFrom: true,
      tiers: { select: { fromMinutes: true, cents: true } },
    },
  });
  if (schedules.length === 0) return DEFAULT_FEE_TIERS;
  const inForce =
    schedules.find((s) => s.effectiveFrom <= when) ??
    schedules[schedules.length - 1];
  return inForce.tiers;
}

/** What this practice's check-ins add up to in charges, right now. */
async function chargesFor(
  practiceId: string,
  tiers: readonly FeeTier[],
): Promise<number> {
  const rows = await prisma.attendance.findMany({
    where: { practiceId, checkedInAt: { not: null } },
    select: { minutesLate: true },
  });
  return rows.reduce((sum, r) => sum + calculateLateFee(r.minutesLate, tiers), 0);
}

/** The practice didn't actually start on time. Everyone's lateness is
 * recalculated from the real start, so nobody carries a penalty for a
 * practice that hadn't begun.
 *
 * **This is the only thing on the attendance sheet that moves money and isn't
 * the AD's.** A choreographer cannot change how late one person was, but
 * pushing the start from 6:00 to 6:10 takes ten minutes off everybody who
 * checked in, charges included. That stays deliberately immediate: it is the
 * honest fix for a rehearsal that began late, it re-derives from check-in
 * times rather than overwriting them — so "Started on time after all" puts
 * every charge straight back — and requiring permission to write down when
 * your own rehearsal started is the paperwork this app just stopped asking
 * for.
 *
 * What it does instead is leave a trace. The practice records who set it and
 * when, and if somebody other than the AD moves money by it, that lands in
 * the AD's queue saying how much. Visible beats forbidden. */
export async function setActualStartTime(
  practiceId: string,
  actualStartIso: string | null,
) {
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    include: { plannedArrivals: true },
  });
  const setter = await requireChoreographerOrAdmin(practice.danceId);
  // A week the AD has signed off must not move under them from here either.
  // `markAttendance` has always checked this; this didn't, which left the one
  // control that re-prices a whole room as the way around the lock.
  await assertWeekOpen(practice.startDateTime);

  const actualStartTime = actualStartIso ? new Date(actualStartIso) : null;
  if (actualStartTime && Number.isNaN(actualStartTime.getTime())) {
    throw new Error("Invalid start time");
  }

  const tiers = await ladderOn(practice.startDateTime);
  const chargesBefore = await chargesFor(practiceId, tiers);

  await prisma.practice.update({
    where: { id: practiceId },
    data: {
      actualStartTime,
      // Clearing the time clears the name with it: there is nothing left to
      // have recorded.
      actualStartSetById: actualStartTime ? setter.id : null,
      actualStartSetAt: actualStartTime ? new Date() : null,
    },
  });

  const settings = await getAttendanceSettings();
  const start = effectivePracticeStart(practice.startDateTime, actualStartTime);
  const plannedByUser = new Map(
    practice.plannedArrivals.map((p) => [p.userId, p.arriveAt]),
  );

  // Every row with a real check-in gets its measurement redone — the
  // measurement is arithmetic, and the inputs just changed.
  const checkIns = await prisma.attendance.findMany({
    where: { practiceId, checkedInAt: { not: null } },
  });

  for (const record of checkIns) {
    const measured = computeMinutesLate(
      record.checkedInAt!,
      start,
      plannedByUser.get(record.userId) ?? null,
    );

    // What is charged follows the measurement, except where somebody has
    // deliberately set it by hand, or where the person was excused and came
    // anyway and is charged nothing on purpose. Recomputing over either of
    // those would quietly undo a decision the AD made.
    const keepCharged =
      record.lateMinutesSetById !== null || record.cameDespiteExcusal;
    const minutesLate = keepCharged ? record.minutesLate : measured;

    await prisma.attendance.update({
      where: { id: record.id },
      data: {
        measuredMinutesLate: measured,
        minutesLate,
        // An absence stays an absence: a later start time says nothing about
        // somebody who never came.
        ...(record.status === "PRESENT" || record.status === "LATE"
          ? {
              status: statusFromCheckIn(
                minutesLate ?? 0,
                settings.lateThresholdMinutes,
              ),
            }
          : {}),
      },
    });
  }

  // Tell the AD, but only when there is something to tell them: somebody
  // other than them moved the start, and the room's charges actually changed
  // because of it. A choreographer correcting a start time that costs nobody
  // anything needs no queue item — the name on the practice is enough — and a
  // queue that fills with those is a queue that stops being read.
  if (!setter.isAdmin) {
    // One statement per practice, not a trail. If they set 6:10, then 6:05,
    // then put it back, the AD should see where it landed rather than three
    // entries to reconcile; the name and time on the practice are the durable
    // record. Matching on the marker keeps this from touching the other
    // automatic flags, which are about a dancer rather than a start time.
    await prisma.attendanceFlag.deleteMany({
      where: {
        practiceId,
        isAutomatic: true,
        resolvedAt: null,
        body: { startsWith: START_TIME_FLAG },
      },
    });

    const chargesAfter = await chargesFor(practiceId, tiers);
    if (chargesAfter !== chargesBefore) {
      const minutes = actualStartTime
        ? Math.round(
            (actualStartTime.getTime() - practice.startDateTime.getTime()) /
              60000,
          )
        : 0;
      const moved = chargesBefore - chargesAfter;
      await prisma.attendanceFlag.create({
        data: {
          practiceId,
          // The flag is about what they did, so it is filed against them.
          subjectUserId: setter.id,
          raisedById: setter.id,
          isAutomatic: true,
          body:
            START_TIME_FLAG +
            (actualStartTime
              ? `recorded this as starting at ${flagClock.format(actualStartTime)}` +
                (minutes > 0 ? `, ${minutes} minutes late` : "") +
                ". "
              : "put the start back to the scheduled time. ") +
            (moved > 0
              ? `${formatMoney(moved)} of late charges cleared.`
              : `${formatMoney(-moved)} of late charges reinstated.`),
        },
      });
    }
  }

  revalidatePath(`/attendance/${practiceId}`);
  revalidatePath("/admin/attendance");
}

/** The choreographer signing off. Anyone who never checked in is settled
 * first, so submitting always produces a complete record.
 *
 * Deliberately no deadline — check-in closes on time, but a choreographer can
 * come back days later and this still works. */
export async function submitAttendance(practiceId: string) {
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { danceId: true, startDateTime: true },
  });
  const submitter = await requireChoreographerOrAdmin(practice.danceId);
  await assertWeekOpen(practice.startDateTime);

  await settleAttendance(practiceId);
  await prisma.practice.update({
    where: { id: practiceId },
    data: {
      attendanceSubmittedAt: new Date(),
      attendanceSubmittedById: submitter.id,
    },
  });

  revalidatePath("/attendance");
  revalidatePath(`/attendance/${practiceId}`);
  revalidatePath("/my-attendance");
  revalidatePath("/admin/attendance");
}

/** Reopens a submitted record so it can be corrected. */
export async function unsubmitAttendance(practiceId: string) {
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { danceId: true, startDateTime: true },
  });
  await requireChoreographerOrAdmin(practice.danceId);
  await assertWeekOpen(practice.startDateTime);

  await prisma.practice.update({
    where: { id: practiceId },
    data: { attendanceSubmittedAt: null, attendanceSubmittedById: null },
  });
  revalidatePath("/attendance");
  revalidatePath(`/attendance/${practiceId}`);
}

export interface AttendanceWeekRow {
  weekOfIso: string;
  weekLabel: string;
  practiceCount: number;
  submittedCount: number;
  presentCount: number;
  unexcusedCount: number;
  lateCount: number;
  reviewedAtIso: string | null;
  reviewedByName: string | null;
}

/** The archive: every week that had practices, newest first, with the AD's
 * own reviewed tick.
 *
 * Attendance Review was a flat list that grew all term and had no notion of
 * "I've dealt with this". A week is the unit the AD actually works in, so
 * that's the unit that gets ticked off. */
export async function getAttendanceWeeks(): Promise<AttendanceWeekRow[]> {
  await requireAdmin();

  const [practices, reviews] = await Promise.all([
    prisma.practice.findMany({
      where: { status: "CONFIRMED", startDateTime: { lt: new Date() } },
      select: {
        startDateTime: true,
        attendanceSubmittedAt: true,
        attendance: { select: { status: true } },
      },
      orderBy: { startDateTime: "desc" },
    }),
    prisma.attendanceWeekReview.findMany({
      include: { reviewedBy: { select: { name: true, email: true } } },
    }),
  ]);

  const reviewByWeek = new Map(
    reviews.map((r) => [r.weekOf.toISOString(), r]),
  );
  const weeks = new Map<string, AttendanceWeekRow>();

  for (const practice of practices) {
    const weekOf = startOfWeek(practice.startDateTime);
    const key = weekOf.toISOString();
    const review = reviewByWeek.get(key);
    const row =
      weeks.get(key) ??
      ({
        weekOfIso: key,
        weekLabel: formatWeekLabel(weekOf),
        practiceCount: 0,
        submittedCount: 0,
        presentCount: 0,
        unexcusedCount: 0,
        lateCount: 0,
        reviewedAtIso: review?.reviewedAt.toISOString() ?? null,
        reviewedByName:
          review?.reviewedBy?.name ?? review?.reviewedBy?.email ?? null,
      } satisfies AttendanceWeekRow);

    row.practiceCount++;
    if (practice.attendanceSubmittedAt) row.submittedCount++;
    for (const record of practice.attendance) {
      if (record.status === "PRESENT") row.presentCount++;
      else if (record.status === "LATE") {
        row.presentCount++;
        row.lateCount++;
      } else if (record.status === "UNEXCUSED_ABSENT") row.unexcusedCount++;
    }
    weeks.set(key, row);
  }

  return Array.from(weeks.values()).sort((a, b) =>
    b.weekOfIso.localeCompare(a.weekOfIso),
  );
}

/** Ticks a week off, or reopens it. Reopening leaves no trace beyond the row
 * disappearing — the tick is a working state, not a permanent record. */
export async function setWeekReviewed(weekOfIso: string, reviewed: boolean) {
  const admin = await requireAdmin();
  const weekOf = startOfWeek(new Date(weekOfIso));

  if (reviewed) {
    await prisma.attendanceWeekReview.upsert({
      where: { weekOf },
      update: { reviewedAt: new Date(), reviewedById: admin.id },
      create: { weekOf, reviewedById: admin.id },
    });
  } else {
    await prisma.attendanceWeekReview.deleteMany({ where: { weekOf } });
  }
  revalidatePath("/admin/attendance");
  revalidatePath("/attendance");
}
