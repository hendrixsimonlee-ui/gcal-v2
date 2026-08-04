import { endOfDayInApp } from "@/lib/timezone";
/** Attendance classification and rollups.
 *
 * Attendance is self-reported: a dancer taps Check in during the practice and
 * the app works out the rest. These are the pure rules for turning a check-in
 * time (or the absence of one) into a status, and for rolling those up. No
 * database access, which is why it's all directly testable.
 */

export type AttendanceStatus =
  | "PRESENT"
  | "LATE"
  | "EXCUSED_ABSENT"
  | "UNEXCUSED_ABSENT";

export type ConflictStatus = "NOT_REVIEWED" | "EXCUSED" | "UNEXCUSED";

export interface ConflictWindow {
  userId: string;
  startDateTime: Date;
  endDateTime: Date;
  status: ConflictStatus;
}

export interface UnavailabilityWindow {
  userId: string;
  startDate: Date;
  endDate: Date;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function endOfDay(date: Date): Date {
  return endOfDayInApp(date);
}

/** When the practice really began. The choreographer can record a later
 * start, and everyone's lateness is then measured from there — nobody should
 * be marked late for a practice that hadn't started. */
export function effectivePracticeStart(
  scheduledStart: Date,
  actualStartTime: Date | null,
): Date {
  return actualStartTime ?? scheduledStart;
}

/** Minutes late, never negative.
 *
 * Someone with an agreed late arrival is measured against *that* time, not
 * the start — turning up when you said you would is on time, which is the
 * whole point of agreeing it in advance. */
export function computeMinutesLate(
  checkedInAt: Date,
  practiceStart: Date,
  plannedArriveAt: Date | null,
): number {
  const baseline = plannedArriveAt ?? practiceStart;
  const diffMs = checkedInAt.getTime() - baseline.getTime();
  return Math.max(0, Math.round(diffMs / 60000));
}

/** PRESENT under the threshold, LATE at or over it. Under 5 minutes doesn't
 * count against anyone. */
export function statusFromCheckIn(
  minutesLate: number,
  lateThresholdMinutes: number,
): AttendanceStatus {
  return minutesLate >= lateThresholdMinutes ? "LATE" : "PRESENT";
}

/** Does this person have to check in at all?
 *
 * No, if the app already knows they aren't coming — an out-of-town window, or
 * any logged conflict over the practice, whether the AD excused it or not.
 * Either way the absence is already on the record, so there's no reason to
 * chase them. They can still check in if they turn up anyway. */
export function isExpectedToCheckIn(
  userId: string,
  practiceStart: Date,
  practiceEnd: Date,
  conflicts: ConflictWindow[],
  unavailabilities: UnavailabilityWindow[],
): boolean {
  const unavailable = unavailabilities.some(
    (u) =>
      u.userId === userId &&
      overlaps(practiceStart, practiceEnd, u.startDate, endOfDay(u.endDate)),
  );
  if (unavailable) return false;

  return !conflicts.some(
    (c) =>
      c.userId === userId &&
      overlaps(practiceStart, practiceEnd, c.startDateTime, c.endDateTime),
  );
}

/** What to record for someone who never checked in.
 *
 * Unexcused unless the app has a reason to say otherwise: an out-of-town
 * window, or a conflict the AD actually looked at and excused. A conflict
 * nobody reviewed is not an excuse — but the AD can override any of this. */
export function statusForNoCheckIn(
  userId: string,
  practiceStart: Date,
  practiceEnd: Date,
  conflicts: ConflictWindow[],
  unavailabilities: UnavailabilityWindow[],
): AttendanceStatus {
  const unavailable = unavailabilities.some(
    (u) =>
      u.userId === userId &&
      overlaps(practiceStart, practiceEnd, u.startDate, endOfDay(u.endDate)),
  );
  if (unavailable) return "EXCUSED_ABSENT";

  const excused = conflicts.some(
    (c) =>
      c.userId === userId &&
      c.status === "EXCUSED" &&
      overlaps(practiceStart, practiceEnd, c.startDateTime, c.endDateTime),
  );
  return excused ? "EXCUSED_ABSENT" : "UNEXCUSED_ABSENT";
}

export function isPresent(status: AttendanceStatus): boolean {
  return status === "PRESENT" || status === "LATE";
}

export function isAbsent(status: AttendanceStatus): boolean {
  return !isPresent(status);
}

export function isUnexcused(status: AttendanceStatus): boolean {
  return status === "UNEXCUSED_ABSENT";
}

export interface PracticeAttendanceSummary {
  totalCast: number;
  markedCount: number;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  unexcusedCount: number;
  totalMinutesLate: number;
  /** Percentage of those marked who turned up at all, 0–100. */
  presentPercent: number;
  /** Percentage who missed it — the "how many are missing" stat. */
  absentPercent: number;
}

export function summarizePractice(
  records: { status: AttendanceStatus | null; minutesLate?: number | null }[],
): PracticeAttendanceSummary {
  const totalCast = records.length;
  const marked = records.filter(
    (r): r is { status: AttendanceStatus; minutesLate?: number | null } =>
      r.status !== null,
  );
  const markedCount = marked.length;
  const presentCount = marked.filter((r) => isPresent(r.status)).length;
  const lateCount = marked.filter((r) => r.status === "LATE").length;
  const absentCount = marked.filter((r) => isAbsent(r.status)).length;
  const unexcusedCount = marked.filter((r) => isUnexcused(r.status)).length;
  const totalMinutesLate = marked.reduce((sum, r) => sum + (r.minutesLate ?? 0), 0);

  return {
    totalCast,
    markedCount,
    presentCount,
    lateCount,
    absentCount,
    unexcusedCount,
    totalMinutesLate,
    presentPercent:
      markedCount === 0 ? 0 : Math.round((presentCount / markedCount) * 100),
    absentPercent:
      markedCount === 0 ? 0 : Math.round((absentCount / markedCount) * 100),
  };
}

export interface PersonAttendanceSummary {
  userId: string;
  totalMarked: number;
  presentCount: number;
  lateCount: number;
  excusedAbsences: number;
  unexcusedAbsences: number;
  totalMinutesLate: number;
  attendanceRate: number; // 0–100
}

export function summarizePerson(
  userId: string,
  records: { status: AttendanceStatus; minutesLate?: number | null }[],
): PersonAttendanceSummary {
  const totalMarked = records.length;
  const presentCount = records.filter((r) => isPresent(r.status)).length;
  const lateCount = records.filter((r) => r.status === "LATE").length;
  const unexcusedAbsences = records.filter((r) => isUnexcused(r.status)).length;
  const excusedAbsences = records.filter(
    (r) => r.status === "EXCUSED_ABSENT",
  ).length;

  return {
    userId,
    totalMarked,
    presentCount,
    lateCount,
    excusedAbsences,
    unexcusedAbsences,
    totalMinutesLate: records.reduce((sum, r) => sum + (r.minutesLate ?? 0), 0),
    attendanceRate:
      totalMarked === 0 ? 100 : Math.round((presentCount / totalMarked) * 100),
  };
}

/** Flags someone who's missed too many of their recent practices without an
 * excuse. `statusesNewestFirst` should be their marked attendance for one
 * dance, most recent practice first.
 *
 * Lateness is deliberately not counted here — turning up late is a different
 * problem from not turning up, and the AD tracks it separately. */
export function isChronicallyAbsent(
  statusesNewestFirst: AttendanceStatus[],
  threshold: number,
  windowSize: number,
): boolean {
  const window = statusesNewestFirst.slice(0, windowSize);
  return window.filter(isUnexcused).length >= threshold;
}

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  LATE: "Late",
  EXCUSED_ABSENT: "Excused",
  UNEXCUSED_ABSENT: "Unexcused",
};
