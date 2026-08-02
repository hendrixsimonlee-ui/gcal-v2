/** Attendance classification and rollups.
 *
 * An absence isn't just "didn't show up" — the AD needs to tell excused from
 * unexcused (that's the whole point of the conflict categories), so these
 * helpers cross-reference each absence against what the person had logged
 * for that time slot. */

export type AbsenceKind =
  | "present"
  | "excused-unavailable" // out-of-town window covering the practice
  | "excused-conflict" // logged conflict in an excused category
  | "unexcused-conflict" // logged conflict, but not an excused category
  | "no-show"; // absent with nothing logged at all

export interface AttendanceInput {
  userId: string;
  attended: boolean | null; // null = not yet marked
}

export interface ConflictWindow {
  userId: string;
  startDateTime: Date;
  endDateTime: Date;
  isExcused: boolean;
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
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Why a given cast member was (or wasn't) at a practice. */
export function classifyAttendance(
  userId: string,
  attended: boolean,
  practiceStart: Date,
  practiceEnd: Date,
  conflicts: ConflictWindow[],
  unavailabilities: UnavailabilityWindow[],
): AbsenceKind {
  if (attended) return "present";

  const isUnavailable = unavailabilities.some(
    (u) =>
      u.userId === userId &&
      overlaps(practiceStart, practiceEnd, u.startDate, endOfDay(u.endDate)),
  );
  if (isUnavailable) return "excused-unavailable";

  const overlapping = conflicts.filter(
    (c) =>
      c.userId === userId &&
      overlaps(practiceStart, practiceEnd, c.startDateTime, c.endDateTime),
  );
  if (overlapping.length === 0) return "no-show";

  // If any overlapping conflict is excused, give them the benefit of it.
  return overlapping.some((c) => c.isExcused)
    ? "excused-conflict"
    : "unexcused-conflict";
}

export function isUnexcused(kind: AbsenceKind): boolean {
  return kind === "unexcused-conflict" || kind === "no-show";
}

export function isAbsent(kind: AbsenceKind): boolean {
  return kind !== "present";
}

export interface PracticeAttendanceSummary {
  totalCast: number;
  markedCount: number;
  presentCount: number;
  absentCount: number;
  unexcusedCount: number;
  /** Percentage of the cast that showed up, 0–100, of those marked. */
  presentPercent: number;
  /** Percentage of the cast that missed it — the "how many are missing" stat. */
  absentPercent: number;
}

export function summarizePractice(
  records: { kind: AbsenceKind | null }[],
): PracticeAttendanceSummary {
  const totalCast = records.length;
  const marked = records.filter((r) => r.kind !== null);
  const markedCount = marked.length;
  const presentCount = marked.filter((r) => r.kind === "present").length;
  const absentCount = marked.filter((r) => r.kind !== null && isAbsent(r.kind)).length;
  const unexcusedCount = marked.filter(
    (r) => r.kind !== null && isUnexcused(r.kind),
  ).length;

  return {
    totalCast,
    markedCount,
    presentCount,
    absentCount,
    unexcusedCount,
    presentPercent: markedCount === 0 ? 0 : Math.round((presentCount / markedCount) * 100),
    absentPercent: markedCount === 0 ? 0 : Math.round((absentCount / markedCount) * 100),
  };
}

export interface PersonAttendanceSummary {
  userId: string;
  totalMarked: number;
  presentCount: number;
  excusedAbsences: number;
  unexcusedAbsences: number;
  attendanceRate: number; // 0–100
}

export function summarizePerson(
  userId: string,
  kinds: AbsenceKind[],
): PersonAttendanceSummary {
  const totalMarked = kinds.length;
  const presentCount = kinds.filter((k) => k === "present").length;
  const unexcusedAbsences = kinds.filter(isUnexcused).length;
  const excusedAbsences = kinds.filter(
    (k) => isAbsent(k) && !isUnexcused(k),
  ).length;

  return {
    userId,
    totalMarked,
    presentCount,
    excusedAbsences,
    unexcusedAbsences,
    attendanceRate:
      totalMarked === 0 ? 100 : Math.round((presentCount / totalMarked) * 100),
  };
}

/** Flags someone who's missed too many of their recent practices without an
 * excuse. `kindsNewestFirst` should be their marked attendance for one dance,
 * most recent practice first. */
export function isChronicallyAbsent(
  kindsNewestFirst: AbsenceKind[],
  threshold: number,
  windowSize: number,
): boolean {
  const window = kindsNewestFirst.slice(0, windowSize);
  return window.filter(isUnexcused).length >= threshold;
}

export const ABSENCE_LABELS: Record<AbsenceKind, string> = {
  present: "Present",
  "excused-unavailable": "Excused (out of town)",
  "excused-conflict": "Excused",
  "unexcused-conflict": "Unexcused conflict",
  "no-show": "No-show",
};
