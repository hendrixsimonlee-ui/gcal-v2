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

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
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
 * whole point of agreeing it in advance.
 *
 * **Minutes elapsed, not minutes rounded.** This used to round, so somebody
 * walking into a six o'clock rehearsal at 6:04:30 was recorded as five
 * minutes late and charged a dollar, while every clock in the building and
 * every screen in the app said 6:04. Four and a half minutes is four minutes
 * late. You are five minutes late at 6:05:00 and not a second before, which
 * is what everybody already assumed and what the fee ladder was written
 * against. */
export function computeMinutesLate(
  checkedInAt: Date,
  practiceStart: Date,
  plannedArriveAt: Date | null,
): number {
  const baseline = plannedArriveAt ?? practiceStart;
  const diffMs = checkedInAt.getTime() - baseline.getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}

/** PRESENT under the threshold, LATE at or over it. Under 5 minutes doesn't
 * count against anyone.
 *
 * **This is the only thing allowed to decide between PRESENT and LATE.**
 * Nobody picks between them from a dropdown any more, and that is deliberate:
 * when they were two independent stored values, marking somebody "here" wrote
 * `minutesLate = 0` and deleted the fourteen minutes they had been late by,
 * along with the charge. The reverse was as bad — marking somebody "late" left
 * the minutes at zero, so nothing was ever charged. Derive it from the one
 * number that means something and the two can't contradict each other. */
export function statusFromCheckIn(
  minutesLate: number,
  lateThresholdMinutes: number,
): AttendanceStatus {
  return minutesLate >= lateThresholdMinutes ? "LATE" : "PRESENT";
}

/** What somebody chooses on an attendance sheet.
 *
 * Three outcomes, not four. "Late" is missing on purpose — it isn't a decision
 * anybody makes, it is what the minutes say. */
export type AttendanceOutcome = "CAME" | "EXCUSED" | "UNEXCUSED";

export const OUTCOME_LABELS: Record<AttendanceOutcome, string> = {
  CAME: "Came",
  EXCUSED: "Excused",
  UNEXCUSED: "Didn't come",
};

/** The status to store for a chosen outcome.
 *
 * `CAME` still has to ask the minutes, which is the whole point: somebody
 * marked as having come, who the record says walked in twenty minutes in, is
 * late — and stays late however they were marked. */
export function statusForOutcome(
  outcome: AttendanceOutcome,
  minutesLate: number | null,
  lateThresholdMinutes: number,
): AttendanceStatus {
  if (outcome === "EXCUSED") return "EXCUSED_ABSENT";
  if (outcome === "UNEXCUSED") return "UNEXCUSED_ABSENT";
  return statusFromCheckIn(minutesLate ?? 0, lateThresholdMinutes);
}

/** The outcome a stored status corresponds to, for showing the current choice
 * on screen. PRESENT and LATE are both simply "came". */
export function outcomeForStatus(
  status: AttendanceStatus | null,
): AttendanceOutcome | null {
  if (status === null) return null;
  if (status === "EXCUSED_ABSENT") return "EXCUSED";
  if (status === "UNEXCUSED_ABSENT") return "UNEXCUSED";
  return "CAME";
}

/** Does this record look like the old bug ate somebody's lateness?
 *
 * A record carries two numbers now: what the check-in measured, and what is
 * actually charged. They disagreeing is not by itself a problem — most
 * disagreements are either rounding at the edge of a minute or the AD
 * deliberately correcting a figure, and burying them in those would guarantee
 * the real ones go unread.
 *
 * The fingerprint of the bug is narrower than "they differ":
 *
 * - the person demonstrably turned up, so there is a measurement at all;
 * - the measurement is at or over the threshold where money starts;
 * - what is charged is nothing;
 * - and nobody is on record as having decided that.
 *
 * That last condition is what keeps a deliberate write-off from reappearing in
 * the AD's queue every week asking to be decided again. */
export function needsLatenessRecheck(
  record: {
    checkedInAt: Date | null;
    minutesLate: number | null;
    measuredMinutesLate: number | null;
    lateMinutesSetById: string | null;
    cameDespiteExcusal?: boolean;
  },
  graceMinutes: number,
): boolean {
  if (record.checkedInAt === null) return false;
  if (record.lateMinutesSetById !== null) return false;
  // Somebody excused who turned up anyway is charged nothing on purpose.
  if (record.cameDespiteExcusal) return false;
  if (record.measuredMinutesLate === null) return false;
  if (record.measuredMinutesLate < graceMinutes) return false;
  return (record.minutesLate ?? 0) < graceMinutes;
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
): boolean {
  return !conflicts.some(
    (c) =>
      c.userId === userId &&
      overlaps(practiceStart, practiceEnd, c.startDateTime, c.endDateTime),
  );
}

/** What to record for someone who never checked in.
 *
 * Unexcused unless the app has a reason to say otherwise: a conflict the AD
 * actually looked at and excused. A conflict nobody reviewed is not an excuse
 * — but the AD can override any of this.
 *
 * A whole day away is an excused all-day conflict now, so it lands here the
 * same as anything else once the AD has marked it. */
export function statusForNoCheckIn(
  userId: string,
  practiceStart: Date,
  practiceEnd: Date,
  conflicts: ConflictWindow[],
): AttendanceStatus {
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
