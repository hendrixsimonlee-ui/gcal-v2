import { addDays, addWeeks, startOfWeek } from "@/lib/dates";
import {
  addDaysInApp,
  appDateKey,
  minutesIntoAppDay,
  zonedParts,
} from "@/lib/timezone";

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
  /** The event's own title, so a slot can say "Ashley — CHEM 101 lab" rather
   * than just counting heads. Null when the conflict was typed by hand
   * without one. */
  title?: string | null;
}

export interface UnavailabilityInterval {
  userId: string;
  startDate: Date;
  endDate: Date;
  /** "Home for fall break" — shown beside their name so the AD knows why
   * they're out rather than just that they are. */
  reason?: string | null;
}

export interface ExistingPractice {
  id: string;
  danceId: string;
  startDateTime: Date;
  endDateTime: Date;
  castUserIds: string[];
}

/** One block a room is ours: a date and the hours on it.
 *
 * There is no weekly pattern any more. Every block is a real event on the
 * shared spaces calendar, so a room is only bookable when somebody actually
 * booked it — the app can no longer promise time nobody reserved. */
export interface Booking {
  date: Date;
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
}

/** One bookable room and everything needed to test slots against it. Passing
 * several lets the AD search "any space" at once, which is the common case —
 * they usually just want a room, not a specific room. */
export interface SpaceOption {
  spaceId: string;
  spaceName: string;
  bookings: Booking[];
  /** Confirmed practices already booked into THIS space. */
  existingPractices: ExistingPractice[];
}

export interface SchedulingInput {
  castMembers: CastMember[];
  conflicts: ConflictInterval[];
  unavailabilities: UnavailabilityInterval[];
  spaces: SpaceOption[];
  existingPracticesForCast: ExistingPractice[];
  /** Choreographer weekly excuses, keyed by that week's Monday (startOfWeek)
   * ISO string — an excuse only lifts the mandatory-attendance requirement
   * for the week it names, not every week in the search range. */
  choreographerExcusedByWeek: Map<string, Set<string>>;
  ignoredUserIds: Set<string>;
  /** Optional nudge away from times this cast has historically skipped:
   * userId -> dayOfWeek -> unexcused-absence rate (0–1). Omit (or pass an
   * empty map) to rank on current conflicts alone — the AD can switch this
   * off in Settings when they don't want past data influencing suggestions. */
  historicalAbsenceRates?: Map<string, Map<number, number>>;
  danceId: string;
  durationMinutes: number;
  searchWeeks: number;
  slotIncrementMinutes: number;
  /** Search exactly this window instead of "from now, for searchWeeks".
   *
   * Build-the-week needs candidates *inside* one named week. Without this it
   * had to take the general suggestions — the best eight anywhere in the next
   * four weeks — and filter them down to the target week, which usually left
   * nothing at all, because the best eight slots overall are rarely all in the
   * same week. The result was a week that "couldn't be built" while placing
   * the same dances by hand worked fine. */
  windowStart?: Date;
  windowEnd?: Date;
}

export interface CastConflictNote {
  userId: string;
  name: string;
  points: number;
  reason:
    | "unexcused-conflict"
    | "excused-conflict"
    | "other-practice"
    | "historically-absent"
    /** A choreographer who can't make it. Kept separate because it costs far
     * more than a dancer's conflict and the AD needs to see it as its own
     * thing, not buried in a count. */
    | "choreographer-conflict"
    | "choreographer-away";
  /** What the person actually has on, so the AD can judge it rather than just
   * seeing a number. Null for reasons that aren't a logged conflict. */
  title?: string | null;
  startIso?: string;
  endIso?: string;
}

/** Someone unavailable for this whole slot — out of town rather than busy.
 * Kept apart from the conflicted list because they are missing from every
 * slot equally, so counting them as a conflict would be noise. */
export interface AwayCastMember {
  userId: string;
  name: string;
  role: CastRole;
  reason: string | null;
}

export interface CandidateSlot {
  startDateTime: Date;
  endDateTime: Date;
  spaceId: string;
  spaceName: string;
  score: number;
  conflictedCastMembers: CastConflictNote[];
  /** Away for this slot, and deliberately not counted against it. */
  awayCastMembers: AwayCastMember[];
  /** How many choreographers can't make it. One of three missing is a normal
   * slot; the UI shows it without alarm. */
  choreographersMissing: number;
  /** True when every choreographer expected this week is unavailable, so
   * there is nobody to run the rehearsal. Ranked below everything else, but
   * still offered — the AD decides whether to hold it. */
  noChoreographerAvailable: boolean;
}

const UNEXCUSED_CONFLICT_POINTS = 2;
const EXCUSED_CONFLICT_POINTS = 1;
const OTHER_PRACTICE_POINTS = 2;
/** Deliberately below a real logged conflict: history is a hint, not
 * evidence, so it breaks ties without overriding what people actually told
 * us about their availability. */
const MAX_HISTORICAL_POINTS = 1;
/** Below this historical absence rate we don't penalise at all — one bad
 * night shouldn't brand a whole weekday as unworkable. */
const HISTORICAL_RATE_FLOOR = 0.5;
const MAX_CANDIDATES = 8;
/** Keeps the suggestion list varied across dates rather than offering the
 * same afternoon sliced into 30-minute increments. */
const MAX_CANDIDATES_PER_DAY = 2;

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function dateKey(date: Date): string {
  return appDateKey(date);
}

/** The same key for an override's date, which comes from a Prisma `@db.Date`
 * column and is therefore anchored at UTC midnight. Reading it with local
 * getters would move the closure to the day before for anyone west of
 * Greenwich — a closed gym would still be offered as bookable. */
/** The "YYYY-MM-DD" of a `@db.Date` value. Must produce the same shape as
 * `dateKey` above, or a booking silently stops matching the day it covers.
 * Read in UTC because that is how `@db.Date` values are anchored, not because
 * the app runs there. */
function storedDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Generates and ranks candidate practice slots for a dance across one or
 * more spaces.
 *
 * Only two things make a slot impossible: the room isn't ours for the whole
 * window, or another dance is already in it. Everything else is a weight, so
 * the AD is always shown the least-bad options rather than an empty list.
 * Lower scores are better. One choreographer missing out of several is a
 * minor cost, since the others can run the rehearsal; every choreographer
 * missing costs more than the whole cast can add up to, so those slots sort
 * below all others without ever disappearing. People who are away are set
 * aside entirely, since they are missing from every slot equally and cannot
 * change the ranking. */
export function generateCandidateSlots(input: SchedulingInput): CandidateSlot[] {
  const {
    castMembers,
    conflicts,
    unavailabilities,
    spaces,
    existingPracticesForCast,
    choreographerExcusedByWeek,
    ignoredUserIds,
    historicalAbsenceRates,
    danceId,
    durationMinutes,
    searchWeeks,
    slotIncrementMinutes,
  } = input;

  const choreographers = castMembers.filter((m) => m.role === "CHOREOGRAPHER");

  // A named window wins over "from now, for searchWeeks". Build-the-week asks
  // for one specific week, including days already past inside it — the AD
  // schedules Wednesday's rehearsal on Wednesday morning often enough that
  // refusing to look at today is its own bug.
  const searchStart = input.windowStart ?? new Date();
  const searchEnd =
    input.windowEnd ?? addWeeks(startOfWeek(searchStart), searchWeeks);

  // What matters is whether anyone is left to run the rehearsal.
  //
  // A dance with three choreographers loses nothing much when one is busy —
  // the other two take it. So a missing choreographer is only a little worse
  // than a missing dancer, and slots like that stay in ordinary contention.
  //
  // The case that must never be chosen while any alternative exists is *every*
  // choreographer missing: there is then nobody to run the practice at all.
  // That is charged separately, and sized to beat anything the rest of the
  // cast can add up to — the worst a single dancer contributes is an unexcused
  // conflict (2) plus a clash with another dance (2) plus a historical nudge
  // (1), so ten per head with a floor leaves room to spare. Scaling with cast
  // size keeps it true for a dance of six and a dance of twenty-five alike.
  //
  // It is still only a weight, so a week with no better option will offer the
  // slot rather than claiming the week can't be scheduled.
  const NO_CHOREOGRAPHER_PENALTY = 10 * castMembers.length + 50;
  const ONE_CHOREOGRAPHER_MISSING_POINTS = 3;

  const candidates: (CandidateSlot | null)[] = [];

  for (const space of spaces) {
    // Bookings are already dated, so there is nothing to expand — walk the
    // ones inside the search range directly. The old version walked every day
    // of the range working out that day's hours from a weekly pattern plus
    // overrides; with the pattern gone, so is all of that.
    // Keyed with the @db.Date reading, not the Eastern one: a booking's date
    // is a bare calendar day anchored at UTC midnight, and reading that in
    // Eastern lands on the evening before. The day cursor below is Eastern,
    // so the two have to be normalised to the same shape.
    const byDate = new Map<string, { startTime: string; endTime: string }[]>();
    for (const booking of space.bookings) {
      const key = storedDateKey(booking.date);
      const list = byDate.get(key) ?? [];
      list.push({ startTime: booking.startTime, endTime: booking.endTime });
      byDate.set(key, list);
    }

    let cursorDate = startOfWeek(searchStart);
    while (cursorDate < searchEnd) {
      const dayStart = new Date(cursorDate);
      cursorDate = addDaysInApp(cursorDate, 1);
      if (dayStart >= searchEnd) break;

      for (const window of byDate.get(dateKey(dayStart)) ?? []) {
        const windowStartMin = timeToMinutes(window.startTime);
        const windowEndMin = timeToMinutes(window.endTime);
        if (windowEndMin - windowStartMin < durationMinutes) continue;

        for (
          let startMin = windowStartMin;
          startMin + durationMinutes <= windowEndMin;
          startMin += slotIncrementMinutes
        ) {
          const slotStart = minutesIntoAppDay(dayStart, startMin);
          const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);
          if (slotStart < searchStart) continue;

          candidates.push(scoreCandidate(slotStart, slotEnd, space));
        }
      }
    }
  }

  function scoreCandidate(
    start: Date,
    end: Date,
    space: SpaceOption,
  ): CandidateSlot | null {
    // Hard filter: don't double-book this space. Callers pass drafts as well
    // as confirmed practices, so a slot the AD has already pencilled in
    // stays reserved while they build out the rest of the term.
    for (const p of space.existingPractices) {
      if (overlaps(start, end, p.startDateTime, p.endDateTime)) return null;
    }

    const excusedThisWeek = choreographerExcusedByWeek.get(
      startOfWeek(start).toISOString(),
    );

    const conflictedCastMembers: CastConflictNote[] = [];
    const awayCastMembers: AwayCastMember[] = [];
    let score = 0;
    let choreographersMissing = 0;

    // Anyone away is out of the mix, not counted as missing.
    //
    // Someone out of town is unavailable for every slot the week could offer,
    // so scoring them adds the same amount everywhere and cannot change which
    // slot wins — it only makes every option look bad. They're listed
    // separately instead, so the real headcount is still visible when the AD
    // decides whether the rehearsal is worth holding.
    const awayUserIds = new Set<string>();
    for (const member of castMembers) {
      const away = unavailabilities.find(
        (u) =>
          u.userId === member.userId &&
          overlaps(start, end, u.startDate, addDays(u.endDate, 1)),
      );
      if (away) {
        awayUserIds.add(member.userId);
        awayCastMembers.push({
          userId: member.userId,
          name: member.name,
          role: member.role,
          reason: away.reason ?? null,
        });
      }
    }

    // Choreographers are weighted, not required.
    //
    // This used to drop the slot outright. One choreographer with a busy week
    // could therefore delete every slot in it, and the week came back as "no
    // viable rehearsal time" — with no way to see how close anything got.
    //
    // The count that matters is how many are left, not how many are missing:
    // with three choreographers, one being busy costs the rehearsal very
    // little, because the other two run it. So each absence is charged
    // lightly here, and the heavy penalty below applies only when the last
    // one goes.
    const expectedChoreographers = choreographers.filter(
      (c) =>
        !excusedThisWeek?.has(c.userId) &&
        !ignoredUserIds.has(c.userId) &&
        !awayUserIds.has(c.userId),
    );

    for (const choreographer of expectedChoreographers) {
      const conflict = conflicts.find(
        (c) =>
          c.userId === choreographer.userId &&
          overlaps(start, end, c.startDateTime, c.endDateTime),
      );
      if (!conflict) continue;

      choreographersMissing++;
      score += ONE_CHOREOGRAPHER_MISSING_POINTS;
      conflictedCastMembers.push({
        userId: choreographer.userId,
        name: choreographer.name,
        points: ONE_CHOREOGRAPHER_MISSING_POINTS,
        reason: "choreographer-conflict",
        title: conflict.title ?? null,
        startIso: conflict.startDateTime.toISOString(),
        endIso: conflict.endDateTime.toISOString(),
      });
    }

    // Nobody left to run it. The one case that must lose to any alternative.
    //
    // Guarded on there having been someone to lose in the first place: if
    // every choreographer is away or excused this week, the AD has already
    // decided the dance runs without them, and charging for it would penalise
    // every slot equally for a decision already made.
    const noChoreographerLeft =
      expectedChoreographers.length > 0 &&
      choreographersMissing === expectedChoreographers.length;
    if (noChoreographerLeft) {
      score += NO_CHOREOGRAPHER_PENALTY;
    }

    // Soft score: everyone else's conflicts and other-dance practices.
    const choreographerIds = new Set(choreographers.map((c) => c.userId));

    for (const member of castMembers) {
      if (ignoredUserIds.has(member.userId)) continue;
      // A choreographer excused for this week is fully exempt, not just
      // from the hard mandatory-attendance requirement — their conflict
      // shouldn't count against the ranking either.
      if (excusedThisWeek?.has(member.userId)) continue;
      if (awayUserIds.has(member.userId)) continue;
      // Already charged, at the much heavier choreographer rate, just above.
      if (choreographerIds.has(member.userId)) continue;

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
          // What they actually have on. A count tells the AD how many can't
          // come; the title and time tell them whether it's worth moving.
          title: conflict.title ?? null,
          startIso: conflict.startDateTime.toISOString(),
          endIso: conflict.endDateTime.toISOString(),
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

      // Historical nudge: this person tends not to turn up on this weekday.
      const rate = historicalAbsenceRates
        ?.get(member.userId)
        ?.get(zonedParts(start).weekday);
      if (rate !== undefined && rate >= HISTORICAL_RATE_FLOOR) {
        const points = Math.round(rate * MAX_HISTORICAL_POINTS * 100) / 100;
        score += points;
        conflictedCastMembers.push({
          userId: member.userId,
          name: member.name,
          points,
          reason: "historically-absent",
        });
      }
    }

    return {
      startDateTime: start,
      endDateTime: end,
      spaceId: space.spaceId,
      spaceName: space.spaceName,
      score,
      conflictedCastMembers,
      awayCastMembers,
      choreographersMissing,
      noChoreographerAvailable: noChoreographerLeft,
    };
  }

  const scored = candidates.filter((c): c is CandidateSlot => c !== null);
  scored.sort((a, b) => a.score - b.score || a.startDateTime.getTime() - b.startDateTime.getTime());

  // Spread suggestions across days. Without this, a wide-open afternoon
  // produces eight near-identical slots 30 minutes apart on one date, which
  // gives the AD one real option dressed up as eight.
  //
  // De-duping by start time also collapses the same time across rooms; since
  // the list is score-sorted, the room that survives is the best-scoring one
  // for that moment, which is what "any space" should surface.
  const seenStarts = new Set<number>();
  const perDayCount = new Map<string, number>();
  const picked: CandidateSlot[] = [];
  const overflow: CandidateSlot[] = [];

  for (const slot of scored) {
    const startKey = slot.startDateTime.getTime();
    if (seenStarts.has(startKey)) continue;
    seenStarts.add(startKey);

    const dayKey = dateKey(slot.startDateTime);
    const used = perDayCount.get(dayKey) ?? 0;
    if (used >= MAX_CANDIDATES_PER_DAY) {
      overflow.push(slot);
      continue;
    }
    perDayCount.set(dayKey, used + 1);
    picked.push(slot);
    if (picked.length >= MAX_CANDIDATES) break;
  }

  // If spreading left us short (e.g. the space is only open one day a week),
  // backfill from the slots the per-day cap held back.
  for (const slot of overflow) {
    if (picked.length >= MAX_CANDIDATES) break;
    picked.push(slot);
  }

  picked.sort(
    (a, b) => a.score - b.score || a.startDateTime.getTime() - b.startDateTime.getTime(),
  );
  return picked;
}
