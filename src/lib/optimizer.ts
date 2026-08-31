/** Scheduling a whole week at once, instead of one dance at a time.
 *
 * The problem with placing dances one by one is that whichever dance the AD
 * happens to open first takes the best slot, and a dance that only ever had
 * two workable times finds both gone. Solving the week together lets a dance
 * with plenty of options give way to one with almost none, which puts more
 * people in more rooms overall.
 *
 * What it optimises for, in the AD's words: maximise overall attendance,
 * minimise conflicts, and don't let the same person keep being the one who
 * misses out.
 *
 * ## The priority scheme
 *
 * 1. **Hard constraints are never traded away.** A room can't hold two
 *    dances at once, nobody can be in two places at once, and a
 *    choreographer who isn't excused has to be there. These filter, they
 *    don't score.
 *
 * 2. **Dances are placed most-constrained first.** A dance with three
 *    workable slots is placed before one with thirty. This is what actually
 *    gets everything scheduled — placing the flexible dance first is how you
 *    end up unable to place the rigid one.
 *
 * 3. **A slot's value is the attendance it buys**, counted as people rather
 *    than as a penalty score, so the numbers mean something to the AD: "11 of
 *    14" is legible in a way that "score 6" is not.
 *
 * 4. **Someone who has already missed this dance counts for more.** Their
 *    presence is weighted up, so when the solver has to disappoint somebody
 *    it disappoints whoever has been present all term rather than the person
 *    who has already missed three. This is the "not missing too many dances"
 *    requirement, and it is the one piece of the scheme that deliberately
 *    trades a little total attendance for fairness.
 *
 * 5. **Ties break toward the earlier slot**, so a week fills from the front
 *    and the AD isn't left with everything on Sunday night.
 *
 * The solver is greedy by that ordering, then does pairwise swaps while they
 * improve the total. Not provably optimal — an exact solve of an assignment
 * problem this shape is overkill for ~15 dances — but it beats first-come
 * ordering comfortably, and it is fast enough to rerun on every change.
 */

import type { CandidateSlot } from "@/lib/scheduling";

/** How much a person's prior absences inflate the value of their attending.
 * At 1.0 someone who has missed every practice counts double someone who has
 * missed none. Kept at that: high enough to break the pattern of the same
 * person always losing, low enough that it can't outweigh several people. */
export const DEFAULT_DEFICIT_WEIGHT = 1.0;

/** Absence rates below this are ignored. Missing one practice out of ten is
 * ordinary life, not a pattern worth reshaping the schedule around. */
const DEFICIT_FLOOR = 0.2;

/** Cap on improvement passes, so a pathological input can't spin. */
const MAX_IMPROVEMENT_PASSES = 6;

export type CastMember = {
  userId: string;
  role: "DANCER" | "CHOREOGRAPHER";
};

export type DanceToPlace = {
  danceId: string;
  danceName: string;
  cast: CastMember[];
  /** Ranked slots from the existing per-dance engine. Hard constraints have
   * already been applied, so anything in here is legal on its own. */
  candidates: CandidateSlot[];
  /** The AD marked this dance as the one that matters most this week, so it
   * picks its slot before everything else. */
  priority?: boolean;
};

export type AttendanceHistory = {
  /** Key: `${userId}:${danceId}`. */
  missRateByMemberDance: Map<string, number>;
};

export type OptimizerInput = {
  dances: DanceToPlace[];
  history?: AttendanceHistory;
  deficitWeight?: number;
};

export type Placement = {
  danceId: string;
  danceName: string;
  slot: CandidateSlot;
  /** People with no conflict at this time, who we therefore expect. */
  expectedCount: number;
  castSize: number;
  /** Who can't make it, so the AD can see the cost of the choice. */
  missingUserIds: string[];
};

export type Unplaced = {
  danceId: string;
  danceName: string;
  reason: string;
};

export type OptimizerResult = {
  placements: Placement[];
  unplaced: Unplaced[];
  /** Weighted total the solver maximised. Only meaningful compared against
   * another run of the same week. */
  totalValue: number;
  /** Plain headcount across every placement — what the AD actually cares
   * about. */
  totalExpectedAttendance: number;
};

/** How much this person attending is worth. Someone who keeps missing this
 * dance is worth more, so the solver stops picking the same loser. */
function memberWeight(
  userId: string,
  danceId: string,
  history: AttendanceHistory | undefined,
  deficitWeight: number,
): number {
  const rate = history?.missRateByMemberDance.get(`${userId}:${danceId}`) ?? 0;
  if (rate <= DEFICIT_FLOOR) return 1;
  // Rescale so the floor is the zero point rather than stepping at it.
  const excess = (rate - DEFICIT_FLOOR) / (1 - DEFICIT_FLOOR);
  return 1 + deficitWeight * excess;
}

/** Who we expect at this slot.
 *
 * Only genuine unavailability counts as missing — a logged conflict, or a
 * practice for another dance at the same time. The engine also flags people
 * as `historically-absent`, but that is a guess about behaviour rather than
 * a statement that they can't come, and treating it as an absence here would
 * be perverse: it would push the solver away from including exactly the
 * people the fairness weighting exists to include. It stays a tie-breaker in
 * the per-dance ranking, which is where it belongs. */
function attendeesFor(dance: DanceToPlace, slot: CandidateSlot): Set<string> {
  const conflicted = new Set(
    slot.conflictedCastMembers
      .filter((c) => c.reason !== "historically-absent")
      .map((c) => c.userId),
  );
  const present = new Set<string>();
  for (const member of dance.cast) {
    if (!conflicted.has(member.userId)) present.add(member.userId);
  }
  return present;
}

function slotValue(
  dance: DanceToPlace,
  slot: CandidateSlot,
  history: AttendanceHistory | undefined,
  deficitWeight: number,
): number {
  let value = 0;
  for (const userId of attendeesFor(dance, slot)) {
    value += memberWeight(userId, dance.danceId, history, deficitWeight);
  }
  return value;
}

function overlaps(a: CandidateSlot, b: CandidateSlot): boolean {
  return a.startDateTime < b.endDateTime && b.startDateTime < a.endDateTime;
}

/** Can these two dances both happen as placed? Two hard rules: one room can
 * only hold one dance at a time, and nobody can be in two rooms at once. */
function compatible(
  a: { dance: DanceToPlace; slot: CandidateSlot },
  b: { dance: DanceToPlace; slot: CandidateSlot },
): boolean {
  if (!overlaps(a.slot, b.slot)) return true;
  if (a.slot.spaceId === b.slot.spaceId) return false;

  const aIds = new Set(a.dance.cast.map((m) => m.userId));
  return !b.dance.cast.some((m) => aIds.has(m.userId));
}

export function solveWeek(input: OptimizerInput): OptimizerResult {
  const deficitWeight = input.deficitWeight ?? DEFAULT_DEFICIT_WEIGHT;
  const { history } = input;

  // Priority first, then most constrained.
  //
  // Most-constrained-first is the right default: the dance with the fewest
  // workable times is the one that can most easily end up with nothing, so it
  // should pick before a dance that has five options. But it optimises for
  // "everything gets placed", and sometimes the AD knows something the data
  // doesn't — a piece going into a showcase, a week where one dance has to
  // have everybody there. A dance marked priority picks first regardless of
  // how many options it has; the rest keep the usual ordering among
  // themselves. Cast size breaks ties within each group, since a big dance is
  // harder to fit later.
  const ordered = [...input.dances].sort((a, b) => {
    if (Boolean(a.priority) !== Boolean(b.priority)) {
      return a.priority ? -1 : 1;
    }
    if (a.candidates.length !== b.candidates.length) {
      return a.candidates.length - b.candidates.length;
    }
    return b.cast.length - a.cast.length;
  });

  const placed: { dance: DanceToPlace; slot: CandidateSlot }[] = [];
  const unplaced: Unplaced[] = [];

  for (const dance of ordered) {
    if (dance.candidates.length === 0) {
      unplaced.push({
        danceId: dance.danceId,
        danceName: dance.danceName,
        reason:
          "No slot works — the room isn't free, or a choreographer isn't available at any open time.",
      });
      continue;
    }

    let best: CandidateSlot | null = null;
    let bestValue = -Infinity;

    for (const slot of dance.candidates) {
      const proposal = { dance, slot };
      if (placed.some((p) => !compatible(p, proposal))) continue;

      const value = slotValue(dance, slot, history, deficitWeight);
      // Ties go to the earlier slot, so the week fills from the front.
      if (
        value > bestValue ||
        (value === bestValue &&
          best !== null &&
          slot.startDateTime < best.startDateTime)
      ) {
        best = slot;
        bestValue = value;
      }
    }

    if (best) placed.push({ dance, slot: best });
    else
      unplaced.push({
        danceId: dance.danceId,
        danceName: dance.danceName,
        reason:
          "Every workable slot clashes with another dance already placed — same room, or shared dancers.",
      });
  }

  improveBySwapping(placed, history, deficitWeight);

  const placements: Placement[] = placed.map(({ dance, slot }) => {
    const attendees = attendeesFor(dance, slot);
    return {
      danceId: dance.danceId,
      danceName: dance.danceName,
      slot,
      expectedCount: attendees.size,
      castSize: dance.cast.length,
      missingUserIds: dance.cast
        .map((m) => m.userId)
        .filter((id) => !attendees.has(id)),
    };
  });

  // Report in the order the week runs, not the order they were solved.
  placements.sort(
    (a, b) => a.slot.startDateTime.getTime() - b.slot.startDateTime.getTime(),
  );

  return {
    placements,
    unplaced,
    totalValue: placed.reduce(
      (sum, p) => sum + slotValue(p.dance, p.slot, history, deficitWeight),
      0,
    ),
    totalExpectedAttendance: placements.reduce(
      (sum, p) => sum + p.expectedCount,
      0,
    ),
  };
}

/** Greedy ordering can leave an obvious improvement on the table: two dances
 * that would each be better off in the other's slot. Repeatedly try every
 * pair and keep any swap that raises the weighted total. */
function improveBySwapping(
  placed: { dance: DanceToPlace; slot: CandidateSlot }[],
  history: AttendanceHistory | undefined,
  deficitWeight: number,
): void {
  for (let pass = 0; pass < MAX_IMPROVEMENT_PASSES; pass++) {
    let improved = false;

    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];

        // Each dance has to actually be able to use the other's slot.
        const aCanTakeB = a.dance.candidates.some(
          (c) => sameSlot(c, b.slot),
        );
        const bCanTakeA = b.dance.candidates.some(
          (c) => sameSlot(c, a.slot),
        );
        if (!aCanTakeB || !bCanTakeA) continue;

        const swappedA = { dance: a.dance, slot: b.slot };
        const swappedB = { dance: b.dance, slot: a.slot };

        const others = placed.filter((_, k) => k !== i && k !== j);
        const legal =
          compatible(swappedA, swappedB) &&
          others.every(
            (o) => compatible(o, swappedA) && compatible(o, swappedB),
          );
        if (!legal) continue;

        const before =
          slotValue(a.dance, a.slot, history, deficitWeight) +
          slotValue(b.dance, b.slot, history, deficitWeight);
        const after =
          slotValue(a.dance, b.slot, history, deficitWeight) +
          slotValue(b.dance, a.slot, history, deficitWeight);

        if (after > before) {
          placed[i] = swappedA;
          placed[j] = swappedB;
          improved = true;
        }
      }
    }

    if (!improved) return;
  }
}

function sameSlot(a: CandidateSlot, b: CandidateSlot): boolean {
  return (
    a.spaceId === b.spaceId &&
    a.startDateTime.getTime() === b.startDateTime.getTime() &&
    a.endDateTime.getTime() === b.endDateTime.getTime()
  );
}

/** Turns raw attendance counts into the miss rates the solver weights by. */
export function buildHistory(
  rows: { userId: string; danceId: string; missed: number; total: number }[],
): AttendanceHistory {
  const missRateByMemberDance = new Map<string, number>();
  for (const row of rows) {
    if (row.total <= 0) continue;
    missRateByMemberDance.set(
      `${row.userId}:${row.danceId}`,
      row.missed / row.total,
    );
  }
  return { missRateByMemberDance };
}
