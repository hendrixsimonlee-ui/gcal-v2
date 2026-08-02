import { addDays, addWeeks, startOfWeek } from "@/lib/dates";

export type CastRole = "DANCER" | "CHOREOGRAPHER";

export interface CastMember {
  userId: string;
  name: string;
  role: CastRole;
}

export interface ConflictInterval {
  id: string;
  userId: string;
  startDateTime: Date;
  endDateTime: Date;
  isExcused: boolean;
}

export interface UnavailabilityInterval {
  userId: string;
  startDate: Date;
  endDate: Date;
}

export interface ExistingPractice {
  id: string;
  danceId: string;
  startDateTime: Date;
  endDateTime: Date;
  castUserIds: string[];
}

export interface RecurringWindow {
  dayOfWeek: number; // 0 = Sunday ... 6 = Saturday
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
}

export interface DateOverride {
  date: Date;
  isAvailable: boolean;
}

export interface SchedulingInput {
  castMembers: CastMember[];
  conflicts: ConflictInterval[];
  unavailabilities: UnavailabilityInterval[];
  existingPracticesAtSpace: ExistingPractice[];
  existingPracticesForCast: ExistingPractice[];
  recurringWindows: RecurringWindow[];
  dateOverrides: DateOverride[];
  /** Choreographer weekly excuses, keyed by that week's Monday (startOfWeek)
   * ISO string — an excuse only lifts the mandatory-attendance requirement
   * for the week it names, not every week in the search range. */
  choreographerExcusedByWeek: Map<string, Set<string>>;
  ignoredUserIds: Set<string>;
  danceId: string;
  durationMinutes: number;
  searchWeeks: number;
  slotIncrementMinutes: number;
}

export interface CastConflictNote {
  userId: string;
  name: string;
  points: number;
  reason: "unexcused-conflict" | "excused-conflict" | "other-practice";
}

export interface CandidateSlot {
  startDateTime: Date;
  endDateTime: Date;
  score: number;
  conflictedCastMembers: CastConflictNote[];
}

const UNEXCUSED_CONFLICT_POINTS = 2;
const EXCUSED_CONFLICT_POINTS = 1;
const OTHER_PRACTICE_POINTS = 2;
const MAX_CANDIDATES = 8;

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Generates and ranks candidate practice slots for a dance at a given space.
 * Hard-filters on space availability, room double-booking, and mandatory
 * choreographer availability; soft-scores the rest of the cast (lower is
 * better) so callers can rank "good enough" options against each other. */
export function generateCandidateSlots(input: SchedulingInput): CandidateSlot[] {
  const {
    castMembers,
    conflicts,
    unavailabilities,
    existingPracticesAtSpace,
    existingPracticesForCast,
    recurringWindows,
    dateOverrides,
    choreographerExcusedByWeek,
    ignoredUserIds,
    danceId,
    durationMinutes,
    searchWeeks,
    slotIncrementMinutes,
  } = input;

  const overrideByDateKey = new Map(
    dateOverrides.map((o) => [dateKey(o.date), o.isAvailable]),
  );

  const choreographers = castMembers.filter((m) => m.role === "CHOREOGRAPHER");
  const searchStart = new Date();
  const searchEnd = addWeeks(startOfWeek(searchStart), searchWeeks);

  const candidates: (CandidateSlot | null)[] = [];

  for (const window of recurringWindows) {
    const windowStartMin = timeToMinutes(window.startTime);
    const windowEndMin = timeToMinutes(window.endTime);
    if (windowEndMin - windowStartMin < durationMinutes) continue;

    let cursorDate = startOfWeek(searchStart);
    while (cursorDate < searchEnd) {
      const dayOffset = (window.dayOfWeek - cursorDate.getDay() + 7) % 7;
      const candidateDate = addDays(cursorDate, dayOffset);
      if (candidateDate >= searchStart && candidateDate < searchEnd) {
        const override = overrideByDateKey.get(dateKey(candidateDate));
        if (override !== false) {
          for (
            let startMin = windowStartMin;
            startMin + durationMinutes <= windowEndMin;
            startMin += slotIncrementMinutes
          ) {
            const slotStart = new Date(candidateDate);
            slotStart.setHours(0, startMin, 0, 0);
            const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);
            if (slotStart < searchStart) continue;

            candidates.push(scoreCandidate(slotStart, slotEnd));
          }
        }
      }
      cursorDate = addWeeks(cursorDate, 1);
    }
  }

  function scoreCandidate(start: Date, end: Date): CandidateSlot | null {
    // Hard filter: don't double-book the space.
    for (const p of existingPracticesAtSpace) {
      if (overlaps(start, end, p.startDateTime, p.endDateTime)) return null;
    }

    // Hard filter: every mandatory (non-excused, non-ignored) choreographer
    // must be free of conflicts and unavailability. Excuses are specific to
    // the week this candidate falls in.
    const excusedThisWeek = choreographerExcusedByWeek.get(
      startOfWeek(start).toISOString(),
    );
    for (const choreographer of choreographers) {
      if (excusedThisWeek?.has(choreographer.userId)) continue;
      if (ignoredUserIds.has(choreographer.userId)) continue;

      const hasConflict = conflicts.some(
        (c) =>
          c.userId === choreographer.userId &&
          overlaps(start, end, c.startDateTime, c.endDateTime),
      );
      const isUnavailable = unavailabilities.some(
        (u) =>
          u.userId === choreographer.userId &&
          overlaps(start, end, u.startDate, addDays(u.endDate, 1)),
      );
      if (hasConflict || isUnavailable) return null;
    }

    // Soft score: everyone else's conflicts and other-dance practices.
    const conflictedCastMembers: CastConflictNote[] = [];
    let score = 0;

    for (const member of castMembers) {
      if (ignoredUserIds.has(member.userId)) continue;
      // A choreographer excused for this week is fully exempt, not just
      // from the hard mandatory-attendance requirement — their conflict
      // shouldn't count against the ranking either.
      if (excusedThisWeek?.has(member.userId)) continue;
      const isUnavailable = unavailabilities.some(
        (u) =>
          u.userId === member.userId &&
          overlaps(start, end, u.startDate, addDays(u.endDate, 1)),
      );
      if (isUnavailable) continue;

      const memberConflicts = conflicts.filter(
        (c) =>
          c.userId === member.userId &&
          overlaps(start, end, c.startDateTime, c.endDateTime),
      );
      for (const conflict of memberConflicts) {
        const points = conflict.isExcused
          ? EXCUSED_CONFLICT_POINTS
          : UNEXCUSED_CONFLICT_POINTS;
        score += points;
        conflictedCastMembers.push({
          userId: member.userId,
          name: member.name,
          points,
          reason: conflict.isExcused ? "excused-conflict" : "unexcused-conflict",
        });
      }

      const otherPractice = existingPracticesForCast.some(
        (p) =>
          p.danceId !== danceId &&
          p.castUserIds.includes(member.userId) &&
          overlaps(start, end, p.startDateTime, p.endDateTime),
      );
      if (otherPractice) {
        score += OTHER_PRACTICE_POINTS;
        conflictedCastMembers.push({
          userId: member.userId,
          name: member.name,
          points: OTHER_PRACTICE_POINTS,
          reason: "other-practice",
        });
      }
    }

    return { startDateTime: start, endDateTime: end, score, conflictedCastMembers };
  }

  const scored = candidates.filter((c): c is CandidateSlot => c !== null);
  scored.sort((a, b) => a.score - b.score || a.startDateTime.getTime() - b.startDateTime.getTime());

  // De-dupe identical start times (can happen if multiple windows overlap).
  const seen = new Set<number>();
  const deduped: CandidateSlot[] = [];
  for (const slot of scored) {
    const key = slot.startDateTime.getTime();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(slot);
    if (deduped.length >= MAX_CANDIDATES) break;
  }

  return deduped;
}
