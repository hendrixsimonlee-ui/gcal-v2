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
  isExpectedToCheckIn,
  statusForNoCheckIn,
  statusFromCheckIn,
  type AttendanceStatus,
} from "@/lib/attendance";
import { formatWeekLabel, startOfWeek } from "@/lib/dates";

const SETTINGS_ID = "singleton";

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

  const [conflicts, unavailabilities] = await Promise.all([
    prisma.conflict.findMany({ where: { userId: user.id } }),
    prisma.unavailability.findMany({ where: { userId: user.id } }),
  ]);

  return practices
    .filter((p) => {
      // Someone who already checked in still sees it — that's how they know
      // it worked, and it shows how late they were.
      if (p.attendance.length > 0) return true;
      // An agreed late arrival is exactly the case where they DO check in.
      if (p.plannedArrivals.length > 0) return true;
      return isExpectedToCheckIn(
        user.id,
        p.startDateTime,
        p.endDateTime,
        conflicts,
        unavailabilities,
      );
    })
    .map((p) => ({
      practiceId: p.id,
      danceName: p.dance.name,
      spaceName: p.space?.name ?? null,
      startDateTime: p.startDateTime,
      endDateTime: p.endDateTime,
      plannedArriveAt: p.plannedArrivals[0]?.arriveAt ?? null,
      alreadyCheckedInAt: p.attendance[0]?.checkedInAt ?? null,
      minutesLate: p.attendance[0]?.minutesLate ?? null,
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
  const minutesLate = computeMinutesLate(
    now,
    start,
    practice.plannedArrivals[0]?.arriveAt ?? null,
  );
  const status = statusFromCheckIn(minutesLate, settings.lateThresholdMinutes);

  await prisma.attendance.upsert({
    where: { practiceId_userId: { practiceId, userId: user.id } },
    update: { status, checkedInAt: now, minutesLate, isOverride: false },
    create: {
      practiceId,
      userId: user.id,
      status,
      checkedInAt: now,
      minutesLate,
    },
  });

  revalidatePath("/schedule");
  revalidatePath("/my-attendance");
  revalidatePath(`/attendance/${practiceId}`);
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

  const [conflicts, unavailabilities, exclusions] = await Promise.all([
    prisma.conflict.findMany({ where: { userId: { in: missing } } }),
    prisma.unavailability.findMany({ where: { userId: { in: missing } } }),
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
            unavailabilities,
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

/** A choreographer or admin correcting one person's record — they were there
 * but their phone died, or an absence deserves excusing after the fact. */
export async function overrideAttendance(
  practiceId: string,
  userId: string,
  status: AttendanceStatus,
) {
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { danceId: true, startDateTime: true },
  });
  const marker = await requireChoreographerOrAdmin(practice.danceId);
  await assertWeekOpen(practice.startDateTime);

  await prisma.attendance.upsert({
    where: { practiceId_userId: { practiceId, userId } },
    update: {
      status,
      isOverride: true,
      markedById: marker.id,
      markedAt: new Date(),
      // Clearing an absence shouldn't leave a stale lateness behind.
      ...(status === "PRESENT" ? { minutesLate: 0 } : {}),
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

/** The practice didn't actually start on time. Everyone's lateness is
 * recalculated from the real start, so nobody carries a penalty for a
 * practice that hadn't begun. */
export async function setActualStartTime(
  practiceId: string,
  actualStartIso: string | null,
) {
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    include: { plannedArrivals: true },
  });
  await requireChoreographerOrAdmin(practice.danceId);

  const actualStartTime = actualStartIso ? new Date(actualStartIso) : null;
  if (actualStartTime && Number.isNaN(actualStartTime.getTime())) {
    throw new Error("Invalid start time");
  }

  await prisma.practice.update({
    where: { id: practiceId },
    data: { actualStartTime },
  });

  const settings = await getAttendanceSettings();
  const start = effectivePracticeStart(practice.startDateTime, actualStartTime);
  const plannedByUser = new Map(
    practice.plannedArrivals.map((p) => [p.userId, p.arriveAt]),
  );

  // Only rows that came from a real check-in: an override is somebody's
  // decision and shouldn't be silently recomputed away.
  const checkIns = await prisma.attendance.findMany({
    where: { practiceId, checkedInAt: { not: null }, isOverride: false },
  });

  for (const record of checkIns) {
    const minutesLate = computeMinutesLate(
      record.checkedInAt!,
      start,
      plannedByUser.get(record.userId) ?? null,
    );
    await prisma.attendance.update({
      where: { id: record.id },
      data: {
        minutesLate,
        status: statusFromCheckIn(minutesLate, settings.lateThresholdMinutes),
      },
    });
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
