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
 * 2. **Every dance getting a time beats every dancer making every time.**
 *    A dance with nobody scheduled rehearses not at all; a dance scheduled at
 *    a time two people can't make still rehearses. So once the greedy pass is
 *    done, anything left unplaced gets a second go in which up to two
 *    already-placed dances are asked to move aside — accepted even when the
 *    move costs attendance, because a placement is worth more than a
 *    headcount.
 *
 * 3. **Dances are placed most-constrained first.** A dance with three
 *    workable slots is placed before one with thirty. This is what actually
 *    gets everything scheduled — placing the flexible dance first is how you
 *    end up unable to place the rigid one.
 *
 * 4. **A slot's value is the attendance it buys**, counted as people rather
 *    than as a penalty score, so the numbers mean something to the AD: "11 of
 *    14" is legible in a way that "score 6" is not.
 *
 *    And a slot ends up with **whichever dance gets the most out of it**, not
 *    whichever was placed first. Swapping two dances only helps when each can
 *    use the other's time; the common case is a slot where one dance would
 *    have its whole cast sitting under a dance that merely quite likes it and
 *    has somewhere else just as good. That is a move, not a swap, so there is
 *    a pass for it — and it only fires when the pair comes out ahead, so
 *    nothing is shunted somewhere worse to suit a dance that gains less.
 *
 * 5. **Someone who has already missed this dance counts for more.** Their
 *    presence is weighted up, so when the solver has to disappoint somebody
 *    it disappoints whoever has been present all term rather than the person
 *    who has already missed three. This is the "not missing too many dances"
 *    requirement, and it is the one piece of the scheme that deliberately
 *    trades a little total attendance for fairness.
 *
 * 6. **Practices in a room are packed back to back.** The club has a fixed
 *    number of booked hours, and a 30-minute hole between two rehearsals is
 *    time nobody can use. Slots that sit flush against a neighbour are
 *    preferred slightly; slots that strand a short gap are avoided slightly.
 *    The *swing* between best- and worst-packed stays under one person's
 *    attendance, so this only ever settles ties — see
 *    `MAX_COMPACTNESS_ADJUSTMENT`, where getting that wrong once already made
 *    the builder pick a snug slot over a slot the whole cast was free for.
 *
 * 7. **Ties break toward the earlier slot**, so a week fills from the front
 *    and the AD isn't left with everything on Sunday night.
 *
 * One run is greedy by that ordering, then rescues unplaced dances by
 * displacement, then does pairwise swaps while they improve the total. The
 * whole week is then solved **several times over from different starting
 * orders**, and the best result kept — because most-constrained-first is a
 * good rule rather than a correct one, and can corner itself in a way another
 * order walks straight past.
 *
 * Run 0 is always the canonical ordering and a rival must be *strictly*
 * better to replace it, so the multi-run search is monotone: it can match or
 * beat the single-run answer, never do worse. The restarts are seeded from
 * the input, so the same week always solves the same way — the randomness
 * varies the search, not the answer.
 *
 * Still not provably optimal; an exact solve of an assignment problem this
 * shape is overkill for ~15 dances. But it is comfortably better than
 * first-come ordering and fast enough to rerun on every change.
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

/** A choreographer in the room is worth more than a dancer in the room.
 *
 * Having none at all is refused outright before the solver ever sees the slot
 * (see `requireChoreographer` in scheduling.ts). This is the other half of the
 * AD's rule — *as many as possible* should be there — and it was missing: the
 * per-dance list already charged 3 for a missing choreographer against 2 for
 * a dancer, but the week solver counted every head the same, so it would
 * happily trade a choreographer for a dancer.
 *
 * Kept at 1.5 rather than something larger: two dancers should still outweigh
 * one choreographer, because a rehearsal is for the cast. It tips the choice
 * when the headcount is close, which is where it belongs. */
const CHOREOGRAPHER_WEIGHT = 1.5;

/** Cap on improvement passes, so a pathological input can't spin. */
const MAX_IMPROVEMENT_PASSES = 6;

/** A gap this short between two practices in the same room is dead time.
 *
 * Nothing the club runs fits in half an hour once people have walked in and
 * warmed up, so a 30-minute hole between two rehearsals is a booked room
 * being paid for and not used. Rehearsals are 60–90 minutes, so anything
 * under 45 counts as stranded. */
export const STRANDED_GAP_MINUTES = 45;

/** Sitting flush against a neighbour is worth a little; stranding a short gap
 * costs a little.
 *
 * What matters is not how big either one is but the **swing between them**:
 * the most a slot can gain minus the most another can lose. A person is worth
 * at least 1 (`memberWeight` only ever scales attendance up), so if the swing
 * reaches 1 the tidier room starts beating the better-attended time.
 *
 * That is exactly what went wrong the first time: clamping each slot to ±1
 * gave a swing of 2, so a flush slot missing somebody could beat a slot where
 * the whole cast was free. The clamp is now ±0.4 — a swing of 0.8, safely
 * under a person — so full attendance always wins and packing only settles
 * ties. `MAX_COMPACTNESS_ADJUSTMENT` must stay below 0.5 for that to hold. */
const FLUSH_BONUS = 0.2;
const STRANDED_GAP_PENALTY = 0.3;
export const MAX_COMPACTNESS_ADJUSTMENT = 0.4;

/** The least a person's attendance can ever be worth. `memberWeight` starts
 * here and only ever scales up, so this is the floor the packing swing has to
 * stay under. Exported so the test can assert the relationship rather than
 * trusting a comment — that is what failed last time. */
export const MIN_MEMBER_WEIGHT = 1;

/** How many slots the displacement rescue will look through per dance. Big
 * enough to cover a week at 30-minute increments across every room, small
 * enough that a pathological input can't stall the button. */
const MAX_DISPLACEMENT_SCAN = 400;

/** Moving two dances at once multiplies the search, so the per-dance scan
 * shrinks when it's doing that. */
const MAX_CHAIN_SCAN = 80;

/** At most two dances are ever moved to fit a third in. Three would take
 * longer to compute than it's worth and would leave the AD unable to explain
 * to anybody why their practice moved. */
const MAX_BLOCKERS_TO_MOVE = 2;

/** Only the first N options of a stuck dance get the expensive two-dance
 * treatment. They're score-ordered, so these are the ones worth having. */
const MAX_CHAIN_SLOTS = 40;

/** How many different orderings to try before settling.
 *
 * Placing most-constrained-first is a good rule, not a correct one: it can
 * paint itself into a corner that a different order walks straight past. So
 * the week is solved several times over from different starting orders and
 * the best result kept. Run 0 is always the canonical ordering, and a rival
 * has to be *strictly* better to displace it — so this can only ever match or
 * beat the single-run answer, never do worse than it. */
const MAX_RUNS = 12;

/** Wall-clock ceiling across all runs. The AD presses a button and waits; a
 * schedule that is 2% better isn't worth five seconds of staring. Run 0
 * always completes regardless. */
const RUN_TIME_BUDGET_MS = 1500;

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
  /** Set by the caller when a dance has no candidates *because* every open
   * time was refused for having no choreographer. Both look like an empty
   * list from here, and they need completely different messages — one means
   * book more room time, the other means talk to the choreographers. */
  blockedByChoreographerGap?: boolean;
};

export type AttendanceHistory = {
  /** Key: `${userId}:${danceId}`. */
  missRateByMemberDance: Map<string, number>;
};

/** A room already spoken for: a published practice, or a draft for a dance
 * this run isn't touching. The solver can't put anything here — candidates
 * were filtered against these already — but it does need to know they exist,
 * so it can pack new practices up against them instead of leaving a
 * half-hour hole nobody can book. */
export type OccupiedInterval = {
  spaceId: string;
  startDateTime: Date;
  endDateTime: Date;
};

export type OptimizerInput = {
  dances: DanceToPlace[];
  history?: AttendanceHistory;
  deficitWeight?: number;
  /** Practices already in the rooms this week, for gap-packing only. */
  occupied?: OccupiedInterval[];
  /** How many different orderings to try. Defaults to MAX_RUNS. Set to 1 to
   * get the plain single-run answer — which is what the monotonicity test
   * compares against, and the escape hatch if the search ever needs turning
   * off in a hurry. */
  maxRuns?: number;
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

/** Why a dance ended up with no time, in a form the AD can act on.
 *
 * One generic "every workable slot clashes with another dance" was the worst
 * kind of message: it told the AD nothing about what to change, and it read
 * as a bug whenever opening that dance on its own showed workable times. Each
 * of these has a different fix, so each says so. */
export type UnplacedCause =
  /** No legal slot at all — no room booked long enough, or every open hour is
   * already taken by a practice. */
  | "no-slots"
  /** There were open times, but no choreographer could make any of them. A
   * practice nobody can lead isn't offered, so the dance has nothing left. */
  | "no-choreographer"
  /** Every option sits in a room another dance is using, and that dance has
   * nowhere else to go. */
  | "room-taken"
  /** Every option overlaps a practice this dance's own people are already in.
   * These *do* show on the dance's own page, marked, because the AD may still
   * want to see them — but nobody can be in two rooms at once. */
  | "cast-double-booked"
  /** The one dance in the way is marked First pick, so it wasn't moved. */
  | "blocked-by-first-pick"
  /** Two or more dances are in the way everywhere, and only one is ever
   * moved. */
  | "too-tangled";

export type Unplaced = {
  danceId: string;
  danceName: string;
  reason: string;
  cause: UnplacedCause;
  /** The dances standing in the way, so the AD knows what to go and look at
   * rather than hunting for it. */
  blockingDanceNames: string[];
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
  const attendees = attendeesFor(dance, slot);
  for (const member of dance.cast) {
    if (!attendees.has(member.userId)) continue;
    const weight = memberWeight(
      member.userId,
      dance.danceId,
      history,
      deficitWeight,
    );
    value +=
      member.role === "CHOREOGRAPHER" ? weight * CHOREOGRAPHER_WEIGHT : weight;
  }
  return value;
}

function overlaps(a: CandidateSlot, b: CandidateSlot): boolean {
  return a.startDateTime < b.endDateTime && b.startDateTime < a.endDateTime;
}

/** How well this slot packs against what else is in its room.
 *
 * The club only has so many booked hours. Two rehearsals with 30 minutes
 * between them waste that gap outright — it is too short to schedule anything
 * into and too long to ignore. So a slot that starts exactly when a
 * neighbour ends (or ends exactly when one starts) is nudged up, and one that
 * leaves a stranded sliver is nudged down.
 *
 * The result is clamped to ±1 — one person's attendance — because this is a
 * tidiness preference, not a reason to rehearse without people. */
function compactnessAdjustment(
  slot: CandidateSlot,
  neighbours: OccupiedInterval[],
): number {
  let adjustment = 0;
  for (const other of neighbours) {
    if (other.spaceId !== slot.spaceId) continue;

    // One of these is the gap; the other is negative (that neighbour is on
    // the far side) and skipped.
    const gapBefore =
      (slot.startDateTime.getTime() - other.endDateTime.getTime()) / 60000;
    const gapAfter =
      (other.startDateTime.getTime() - slot.endDateTime.getTime()) / 60000;

    for (const gap of [gapBefore, gapAfter]) {
      if (gap < 0) continue;
      if (gap === 0) adjustment += FLUSH_BONUS;
      else if (gap <= STRANDED_GAP_MINUTES) adjustment -= STRANDED_GAP_PENALTY;
    }
  }
  return Math.max(
    -MAX_COMPACTNESS_ADJUSTMENT,
    Math.min(MAX_COMPACTNESS_ADJUSTMENT, adjustment),
  );
}

function asInterval(slot: CandidateSlot): OccupiedInterval {
  return {
    spaceId: slot.spaceId,
    startDateTime: slot.startDateTime,
    endDateTime: slot.endDateTime,
  };
}

/** Can these two dances both happen as placed? Two hard rules: one room can
 * only hold one dance at a time, and nobody can be in two rooms at once. */
function compatible(
  a: { dance: DanceToPlace; slot: CandidateSlot },
  b: { dance: DanceToPlace; slot: CandidateSlot },
): boolean {
  if (!overlaps(a.slot, b.slot)) return true;
  if (a.slot.spaceId === b.slot.spaceId) return false;
  return !b.dance.cast.some((m) => castIdsOf(a.dance).has(m.userId));
}

/** Cast lookups happen in the innermost loop of the displacement pass, which
 * can run into the millions of comparisons on a full week. Building the set
 * once per dance rather than once per comparison is the difference between
 * the button feeling instant and feeling stuck. */
const castIdCache = new WeakMap<DanceToPlace, Set<string>>();

function castIdsOf(dance: DanceToPlace): Set<string> {
  let ids = castIdCache.get(dance);
  if (!ids) {
    ids = new Set(dance.cast.map((m) => m.userId));
    castIdCache.set(dance, ids);
  }
  return ids;
}

type Entry = { dance: DanceToPlace; slot: CandidateSlot };

/** Priority first, then most constrained.
 *
 * Most-constrained-first is the right default: the dance with the fewest
 * workable times is the one that can most easily end up with nothing, so it
 * should pick before a dance that has five options. But it optimises for
 * "everything gets placed", and sometimes the AD knows something the data
 * doesn't — a piece going into a showcase, a week where one dance has to have
 * everybody there. A dance marked priority picks first regardless of how many
 * options it has; the rest keep the usual ordering among themselves. Cast
 * size breaks ties within each group, since a big dance is harder to fit
 * later. */
function canonicalOrder(dances: DanceToPlace[]): DanceToPlace[] {
  return [...dances].sort((a, b) => {
    if (Boolean(a.priority) !== Boolean(b.priority)) {
      return a.priority ? -1 : 1;
    }
    if (a.candidates.length !== b.candidates.length) {
      return a.candidates.length - b.candidates.length;
    }
    return b.cast.length - a.cast.length;
  });
}

/** Whatever else an ordering does, dances the AD flagged still go first. That
 * is the one instruction they gave the solver by hand, and no amount of
 * searching for a better arrangement is allowed to quietly drop it. */
function priorityFirst(dances: DanceToPlace[]): DanceToPlace[] {
  return [
    ...dances.filter((d) => d.priority),
    ...dances.filter((d) => !d.priority),
  ];
}

/** Deterministic PRNG (mulberry32).
 *
 * Randomised restarts would normally mean pressing Build twice gives two
 * different schedules, which is maddening when you're comparing options. The
 * seed comes from the input itself, so the same week with the same conflicts
 * always solves the same way — the randomness varies the *search*, not the
 * answer. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(dances: DanceToPlace[]): number {
  let hash = 2166136261;
  for (const id of dances.map((d) => d.danceId).sort()) {
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  // Fold in when the week starts, so the same roster in a different week
  // searches differently.
  const earliest = dances
    .flatMap((d) => (d.candidates[0] ? [d.candidates[0].startDateTime.getTime()] : []))
    .sort((a, b) => a - b)[0];
  if (earliest !== undefined) hash = Math.imul(hash ^ (earliest & 0xffffffff), 16777619);
  return hash >>> 0;
}

function shuffled(dances: DanceToPlace[], rng: () => number): DanceToPlace[] {
  const out = [...dances];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return priorityFirst(out);
}

/** How good a finished week is, for comparing one run against another.
 *
 * Dances placed comes first and is never traded — that is the AD's rule, and
 * a run that schedules one more dance wins however much attendance it cost.
 * Attendance (with the fairness weighting and the room-packing term already
 * in it) only separates runs that placed the same number. */
function scoreArrangement(
  placed: Entry[],
  occupied: OccupiedInterval[],
  history: AttendanceHistory | undefined,
  deficitWeight: number,
): { placedCount: number; value: number } {
  let value = 0;
  for (let i = 0; i < placed.length; i++) {
    const neighbours = [
      ...occupied,
      ...placed.filter((_, k) => k !== i).map((p) => asInterval(p.slot)),
    ];
    value +=
      slotValue(placed[i].dance, placed[i].slot, history, deficitWeight) +
      compactnessAdjustment(placed[i].slot, neighbours);
  }
  return { placedCount: placed.length, value };
}

/** One complete solve from one starting order. Pure: no shared state, so it
 * can be run as many times as the budget allows. */
function attemptWeek(
  ordered: DanceToPlace[],
  occupied: OccupiedInterval[],
  history: AttendanceHistory | undefined,
  deficitWeight: number,
): { placed: Entry[]; unplaced: Unplaced[] } {
  const placed: Entry[] = [];
  const unplaced: Unplaced[] = [];

  for (const dance of ordered) {
    if (dance.candidates.length === 0) {
      unplaced.push({
        danceId: dance.danceId,
        danceName: dance.danceName,
        cause: dance.blockedByChoreographerGap ? "no-choreographer" : "no-slots",
        blockingDanceNames: [],
        reason: dance.blockedByChoreographerGap
          ? "There are open times this week, but no choreographer for this dance can make any of them. A practice with nobody to run it is never drafted, so this one needs a choreographer to free something up — or excuse them for the week if it should go ahead without them."
          : "Nowhere to put it. No room is booked for long enough this week, or every open hour is already taken by a practice.",
      });
      continue;
    }

    let best: CandidateSlot | null = null;
    let bestValue = -Infinity;

    // What's already in the rooms, for the gap-packing term.
    const neighbours = [...occupied, ...placed.map((p) => asInterval(p.slot))];

    for (const slot of dance.candidates) {
      const proposal = { dance, slot };
      if (placed.some((p) => !compatible(p, proposal))) continue;

      const value =
        slotValue(dance, slot, history, deficitWeight) +
        compactnessAdjustment(slot, neighbours);
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
        // Filled in properly once the rescue pass has had its go — until
        // then there is no telling which of the several quite different
        // things went wrong.
        cause: "too-tangled",
        blockingDanceNames: [],
        reason: "",
      });
  }

  // Coverage beats attendance: rescue what greedy left behind, even at a cost.
  const rescued = rescueUnplacedByDisplacement(placed, unplaced, ordered);

  // Then tidy up: a slot should end up with whichever dance gets the most out
  // of it, not whichever dance happened to be placed first.
  for (let pass = 0; pass < MAX_IMPROVEMENT_PASSES; pass++) {
    const swapped = improveBySwapping(placed, occupied, history, deficitWeight);
    const moved = improveByReallocation(placed, history, deficitWeight);
    if (!swapped && !moved) break;
  }

  return {
    placed,
    unplaced: unplaced.filter((u) => !rescued.has(u.danceId)),
  };
}

export function solveWeek(input: OptimizerInput): OptimizerResult {
  const deficitWeight = input.deficitWeight ?? DEFAULT_DEFICIT_WEIGHT;
  const { history } = input;
  const occupied = input.occupied ?? [];
  const byDanceId = new Map(input.dances.map((d) => [d.danceId, d]));

  // Solve the week several times from different starting orders and keep the
  // best. Most-constrained-first is a good rule, not a correct one — it can
  // corner itself in a way a different order walks straight past.
  //
  // Run 0 is the canonical ordering, so the single-run answer is the floor.
  // Every later run has to be *strictly* better to replace it, which makes
  // this monotone: it can match or beat what came before, never undercut it.
  const rng = makeRng(seedFrom(input.dances));
  const orderings: DanceToPlace[][] = [
    canonicalOrder(input.dances),
    // Two cheap deterministic alternatives before falling back on shuffles:
    // biggest cast first (hardest to fit late), and fewest options but
    // smallest cast first, which unsticks the opposite kind of jam.
    priorityFirst([...input.dances].sort((a, b) => b.cast.length - a.cast.length)),
    priorityFirst(
      [...input.dances].sort(
        (a, b) => a.candidates.length - b.candidates.length || a.cast.length - b.cast.length,
      ),
    ),
  ];

  const startedAt = Date.now();
  let best = attemptWeek(orderings[0], occupied, history, deficitWeight);
  let bestScore = scoreArrangement(best.placed, occupied, history, deficitWeight);

  const maxRuns = Math.max(1, input.maxRuns ?? MAX_RUNS);
  for (let run = 1; run < maxRuns; run++) {
    if (Date.now() - startedAt > RUN_TIME_BUDGET_MS) break;
    // Nothing left to find once every dance has a time.
    if (best.unplaced.length === 0 && run > orderings.length) break;

    const order = orderings[run] ?? shuffled(input.dances, rng);
    const attempt = attemptWeek(order, occupied, history, deficitWeight);
    const score = scoreArrangement(attempt.placed, occupied, history, deficitWeight);

    const better =
      score.placedCount > bestScore.placedCount ||
      (score.placedCount === bestScore.placedCount && score.value > bestScore.value);
    if (better) {
      best = attempt;
      bestScore = score;
    }
  }

  const { placed } = best;
  // Explain the leftovers against the arrangement actually being shown, not
  // against some run that was thrown away.
  const stillUnplaced = best.unplaced.map((u) =>
    diagnose(u, byDanceId.get(u.danceId)!, placed),
  );

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
    unplaced: stillUnplaced,
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

/** Works out *which* kind of stuck a dance is, once the rescue pass has
 * failed, and says so in a sentence naming the thing to change.
 *
 * The four are genuinely different problems with genuinely different fixes,
 * and the AD can't tell them apart from the schedule. In particular
 * `cast-double-booked` is the one that looks like a bug and isn't: those
 * times show on the dance's own page — marked, because the AD may still want
 * to see them — while the builder can't use them, since nobody can be in two
 * rooms at once. Saying that out loud is the difference between "the tool is
 * broken" and "of course, Maya's in Bhangra then". */
function diagnose(
  entry: Unplaced,
  dance: DanceToPlace,
  placed: { dance: DanceToPlace; slot: CandidateSlot }[],
): Unplaced {
  // Already fully explained at the point it was skipped: there was never a
  // legal slot, so there is nothing here to have blocked it.
  if (dance.candidates.length === 0) return entry;

  const blockingNames = new Set<string>();
  let sawFirstPickBlocker: string | null = null;
  let everySlotTangled = true;
  let sawRoomClash = false;
  let sawCastClash = false;

  for (const slot of dance.candidates) {
    const proposal = { dance, slot };
    const blockers = placed.filter((p) => !compatible(p, proposal));
    if (blockers.length === 0) continue;
    // "Tangled" means more dances in the way than the rescue will ever move.
    if (blockers.length <= MAX_BLOCKERS_TO_MOVE) everySlotTangled = false;

    for (const blocker of blockers) {
      blockingNames.add(blocker.dance.danceName);
      if (blocker.slot.spaceId === slot.spaceId) sawRoomClash = true;
      else sawCastClash = true;
    }

    if (blockers.length <= MAX_BLOCKERS_TO_MOVE) {
      const flagged = blockers.find((b) => b.dance.priority);
      if (flagged) sawFirstPickBlocker ??= flagged.dance.danceName;
    }
  }

  const names = Array.from(blockingNames).sort();
  const list = names.join(", ");

  let cause: UnplacedCause;
  let reason: string;

  if (sawFirstPickBlocker) {
    cause = "blocked-by-first-pick";
    reason = `The only time that works is held by ${sawFirstPickBlocker}, which you marked First pick — so it wasn't asked to move. Untick First pick on ${sawFirstPickBlocker} and rebuild to let them swap.`;
  } else if (everySlotTangled) {
    cause = "too-tangled";
    reason = `Every open time has three or more dances in the way (${list}), and at most two are ever moved aside. Tick First pick on this dance and rebuild so it chooses before the others.`;
  } else if (sawCastClash && !sawRoomClash) {
    cause = "cast-double-booked";
    reason = `Every open time overlaps a practice its own dancers are already in (${list}). Those times still show on this dance's own page with the clash marked, but nobody can be in two rooms at once, so the builder can't use them.`;
  } else if (sawRoomClash && !sawCastClash) {
    cause = "room-taken";
    reason = `Every open time is in a room ${list} is using, and there is nowhere else for ${names.length === 1 ? "it" : "them"} to go this week.`;
  } else {
    cause = "too-tangled";
    reason = `Every open time clashes with a dance already placed (${list}) — same room, or dancers in both — and the dance in the way had nowhere else to go.`;
  }

  return { ...entry, cause, reason, blockingDanceNames: names };
}

/** Second chance for dances greedy couldn't fit: ask someone to move.
 *
 * This is the AD's rule made concrete — **a dance being on the schedule at
 * all matters more than everyone making every practice.** Greedy stops as
 * soon as a dance has no free slot left, which is the wrong place to stop:
 * often the dance blocking it has somewhere else perfectly good to go, and
 * moving it turns one unscheduled dance into two scheduled ones. The cost is
 * that the dance which moved may land at a time a couple of its dancers
 * can't make, and that trade is accepted on purpose — no attendance test is
 * applied here, only legality.
 *
 * Up to two dances are moved to fit a third in. Three would cost more to
 * compute than it buys and would leave the AD unable to explain to anybody
 * why their practice moved, so the pass stops there.
 *
 * A dance the AD flagged as first pick is never the one asked to move. That
 * flag exists precisely to say "this one keeps the slot it chose", and
 * shuffling it aside to fit something else in would quietly undo the only
 * instruction the AD gave the solver by hand.
 *
 * Returns the ids it managed to place. */
function rescueUnplacedByDisplacement(
  placed: Entry[],
  unplaced: Unplaced[],
  dances: DanceToPlace[],
): Set<string> {
  const rescued = new Set<string>();
  const byId = new Map(dances.map((d) => [d.danceId, d]));

  for (const entry of unplaced) {
    const dance = byId.get(entry.danceId);
    if (!dance || dance.candidates.length === 0) continue;

    let done = false;
    const slots = dance.candidates.slice(0, MAX_DISPLACEMENT_SCAN);

    for (let s = 0; s < slots.length && !done; s++) {
      const proposal = { dance, slot: slots[s] };
      const blockers: number[] = [];
      for (let i = 0; i < placed.length; i++) {
        if (!compatible(placed[i], proposal)) blockers.push(i);
        if (blockers.length > MAX_BLOCKERS_TO_MOVE) break;
      }

      if (blockers.length === 0) {
        // Nothing in the way after all — a later swap freed it up.
        placed.push(proposal);
        done = true;
        break;
      }

      if (blockers.length > MAX_BLOCKERS_TO_MOVE) continue;
      // The AD's flag wins over fitting one more dance in.
      if (blockers.some((i) => placed[i].dance.priority)) continue;
      // Moving two is the expensive case, so only the best few options of the
      // stuck dance get it. They're score-ordered, so those are the ones
      // worth having anyway.
      if (blockers.length > 1 && s >= MAX_CHAIN_SLOTS) continue;

      const moves = relocateAll(blockers, [proposal], placed, blockers);
      if (!moves) continue;

      for (const move of moves) placed[move.index] = move.entry;
      placed.push(proposal);
      done = true;
    }

    if (done) rescued.add(entry.danceId);
  }

  return rescued;
}

/** Finds somewhere for every one of `moving` to go, such that they and
 * everything in `fixed` can coexist.
 *
 * `fixed` holds the placement we're trying to make room for, plus whichever
 * dances have already been given a new slot earlier in this same rescue —
 * two dances shoved aside must not land on top of each other. */
function relocateAll(
  moving: number[],
  fixed: Entry[],
  placed: Entry[],
  allMoving: number[],
): { index: number; entry: Entry }[] | null {
  if (moving.length === 0) return [];

  const [index, ...rest] = moving;
  const blocker = placed[index];
  const scan = allMoving.length > 1 ? MAX_CHAIN_SCAN : MAX_DISPLACEMENT_SCAN;

  for (const alternative of blocker.dance.candidates.slice(0, scan)) {
    const moved: Entry = { dance: blocker.dance, slot: alternative };
    if (!fixed.every((f) => compatible(f, moved))) continue;
    // Everything staying put has to tolerate the new position too. Dances
    // being moved in this same rescue are excluded — they're in `fixed` once
    // they have somewhere to be.
    if (!placed.every((p, k) => allMoving.includes(k) || compatible(p, moved)))
      continue;

    const tail = relocateAll(rest, [...fixed, moved], placed, allMoving);
    if (tail) return [{ index, entry: moved }, ...tail];
  }

  return null;
}

/** Greedy ordering can leave an obvious improvement on the table: two dances
 * that would each be better off in the other's slot. Repeatedly try every
 * pair and keep any swap that raises the weighted total. */
function improveBySwapping(
  placed: Entry[],
  occupied: OccupiedInterval[],
  history: AttendanceHistory | undefined,
  deficitWeight: number,
): boolean {
  let everImproved = false;
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

        // Both sides are measured the same way — attendance plus how well the
        // pair packs into its rooms — so a swap that leaves a stranded gap
        // has to buy more than a person's attendance to be worth taking.
        const context = [...occupied, ...others.map((o) => asInterval(o.slot))];
        const pairValue = (
          x: { dance: DanceToPlace; slot: CandidateSlot },
          y: { dance: DanceToPlace; slot: CandidateSlot },
        ) =>
          slotValue(x.dance, x.slot, history, deficitWeight) +
          slotValue(y.dance, y.slot, history, deficitWeight) +
          compactnessAdjustment(x.slot, [...context, asInterval(y.slot)]) +
          compactnessAdjustment(y.slot, [...context, asInterval(x.slot)]);

        const before = pairValue(a, b);
        const after = pairValue(swappedA, swappedB);

        if (after > before) {
          placed[i] = swappedA;
          placed[j] = swappedB;
          improved = true;
          everImproved = true;
        }
      }
    }

    if (!improved) break;
  }
  return everImproved;
}

/** Gives each slot to the dance that gets the most out of it.
 *
 * Swapping only helps when two dances can each use the other's time. The case
 * it misses is the one the AD kept spotting: a slot where one dance would
 * have full attendance is sitting under a dance that merely *quite likes* it
 * and has somewhere else perfectly good to go. Nothing to swap — the second
 * dance's alternative is empty, not occupied — so the slot stays with
 * whoever was placed first, which is an accident of ordering rather than a
 * decision.
 *
 * So: for every placed dance, look at the times it would rather have. If one
 * is free, take it. If exactly one other dance is in the way and that dance
 * can move somewhere else, move it — but only when the two of them together
 * come out ahead. A dance is never shunted somewhere worse unless the dance
 * taking its place gains more than it loses, and a First pick dance is never
 * shunted at all.
 *
 * Returns whether anything changed, so the caller knows to run another pass. */
function improveByReallocation(
  placed: Entry[],
  history: AttendanceHistory | undefined,
  deficitWeight: number,
): boolean {
  let everImproved = false;

  for (let i = 0; i < placed.length; i++) {
    const current = placed[i];
    const currentValue = slotValue(
      current.dance,
      current.slot,
      history,
      deficitWeight,
    );

    for (const wanted of current.dance.candidates.slice(0, MAX_DISPLACEMENT_SCAN)) {
      // Only chase times that are genuinely better for this dance. Attendance
      // alone here: a move that merely tidies the rooms is the swap pass's
      // job, and chasing those would let this loop churn.
      const gain =
        slotValue(current.dance, wanted, history, deficitWeight) - currentValue;
      if (gain <= 0) continue;

      const proposal: Entry = { dance: current.dance, slot: wanted };
      const blockers: number[] = [];
      for (let k = 0; k < placed.length; k++) {
        if (k === i) continue;
        if (!compatible(placed[k], proposal)) blockers.push(k);
        if (blockers.length > 1) break;
      }

      if (blockers.length === 0) {
        // Free all along — the dance simply hadn't been offered it, because
        // whatever held it when this dance was placed has since moved.
        placed[i] = proposal;
        everImproved = true;
        break;
      }

      if (blockers.length > 1) continue;
      const other = blockers[0];
      if (placed[other].dance.priority) continue;

      const displaced = placed[other];
      const displacedValue = slotValue(
        displaced.dance,
        displaced.slot,
        history,
        deficitWeight,
      );

      let moved = false;
      for (const alternative of displaced.dance.candidates.slice(
        0,
        MAX_CHAIN_SCAN,
      )) {
        const relocated: Entry = { dance: displaced.dance, slot: alternative };
        if (!compatible(relocated, proposal)) continue;
        if (
          !placed.every(
            (p, k) => k === i || k === other || compatible(p, relocated),
          )
        )
          continue;

        // The trade has to be worth it for the pair, not just for the dance
        // doing the asking. This is what stops a dance with a mild preference
        // evicting one that would lose more than it gains.
        const cost =
          displacedValue -
          slotValue(displaced.dance, alternative, history, deficitWeight);
        if (gain - cost <= 0) continue;

        placed[i] = proposal;
        placed[other] = relocated;
        moved = true;
        break;
      }

      if (moved) {
        everImproved = true;
        break;
      }
    }
  }

  return everImproved;
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
