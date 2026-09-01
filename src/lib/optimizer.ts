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
 *    done, anything left unplaced gets a second go in which an already-placed
 *    dance is asked to move aside — accepted even when the move costs
 *    attendance, because a placement is worth more than a headcount.
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
 *    Deliberately under one person's worth, so it only settles near-ties.
 *
 * 7. **Ties break toward the earlier slot**, so a week fills from the front
 *    and the AD isn't left with everything on Sunday night.
 *
 * The solver is greedy by that ordering, then rescues unplaced dances by
 * displacement, then does pairwise swaps while they improve the total. Not
 * provably optimal — an exact solve of an assignment problem this shape is
 * overkill for ~15 dances — but it beats first-come ordering comfortably, and
 * it is fast enough to rerun on every change.
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

/** A gap this short between two practices in the same room is dead time.
 *
 * Nothing the club runs fits in half an hour once people have walked in and
 * warmed up, so a 30-minute hole between two rehearsals is a booked room
 * being paid for and not used. Rehearsals are 60–90 minutes, so anything
 * under 45 counts as stranded. */
export const STRANDED_GAP_MINUTES = 45;

/** Sitting flush against a neighbour is worth a little; stranding a short gap
 * costs a little. Both stay well under 1, which is one person's attendance,
 * so packing a room can never outrank actually having people there — it only
 * decides between options that were otherwise level. */
const FLUSH_BONUS = 0.25;
const STRANDED_GAP_PENALTY = 0.5;
/** Whatever the arrangement, the whole compactness term stays inside ±1. */
const MAX_COMPACTNESS_ADJUSTMENT = 1;

/** How many slots the displacement rescue will look through per dance. Big
 * enough to cover a week at 30-minute increments across every room, small
 * enough that a pathological input can't stall the button. */
const MAX_DISPLACEMENT_SCAN = 400;

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
  for (const userId of attendeesFor(dance, slot)) {
    value += memberWeight(userId, dance.danceId, history, deficitWeight);
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

export function solveWeek(input: OptimizerInput): OptimizerResult {
  const deficitWeight = input.deficitWeight ?? DEFAULT_DEFICIT_WEIGHT;
  const { history } = input;
  const occupied = input.occupied ?? [];

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
  const byDanceId = new Map(ordered.map((d) => [d.danceId, d]));

  for (const dance of ordered) {
    if (dance.candidates.length === 0) {
      unplaced.push({
        danceId: dance.danceId,
        danceName: dance.danceName,
        cause: "no-slots",
        blockingDanceNames: [],
        // Deliberately not "a choreographer isn't available": choreographers
        // are a weight now, not a filter, so they can no longer empty a week.
        reason:
          "Nowhere to put it. No room is booked for long enough this week, or every open hour is already taken by a practice.",
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
  const stillUnplaced = unplaced
    .filter((u) => !rescued.has(u.danceId))
    .map((u) =>
      u.reason === "" ? diagnose(u, byDanceId.get(u.danceId)!, placed) : u,
    );

  improveBySwapping(placed, occupied, history, deficitWeight);

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
  const blockingNames = new Set<string>();
  let sawFirstPickBlocker: string | null = null;
  let everySlotTangled = true;
  let sawRoomClash = false;
  let sawCastClash = false;

  for (const slot of dance.candidates) {
    const proposal = { dance, slot };
    const blockers = placed.filter((p) => !compatible(p, proposal));
    if (blockers.length === 0) continue;
    if (blockers.length === 1) everySlotTangled = false;

    for (const blocker of blockers) {
      blockingNames.add(blocker.dance.danceName);
      if (blocker.slot.spaceId === slot.spaceId) sawRoomClash = true;
      else sawCastClash = true;
    }

    if (blockers.length === 1 && blockers[0].dance.priority) {
      sawFirstPickBlocker ??= blockers[0].dance.danceName;
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
    reason = `Every open time has two or more dances in the way (${list}), and only one is ever moved aside. Tick First pick on this dance and rebuild so it chooses before the others.`;
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
 * Only single blockers are relocated. Cascading two or three moves at once
 * would occasionally place one more dance and would make the result much
 * harder for the AD to reason about ("why did Bhangra move?"), so the pass
 * stops at the version that can be explained in one sentence.
 *
 * A dance the AD flagged as first pick is never the one asked to move. That
 * flag exists precisely to say "this one keeps the slot it chose", and
 * shuffling it aside to fit something else in would quietly undo the only
 * instruction the AD gave the solver by hand.
 *
 * Returns the ids it managed to place. */
function rescueUnplacedByDisplacement(
  placed: { dance: DanceToPlace; slot: CandidateSlot }[],
  unplaced: Unplaced[],
  dances: DanceToPlace[],
): Set<string> {
  const rescued = new Set<string>();
  const byId = new Map(dances.map((d) => [d.danceId, d]));

  for (const entry of unplaced) {
    const dance = byId.get(entry.danceId);
    if (!dance || dance.candidates.length === 0) continue;

    let done = false;
    for (const slot of dance.candidates.slice(0, MAX_DISPLACEMENT_SCAN)) {
      const proposal = { dance, slot };
      const blockers: number[] = [];
      for (let i = 0; i < placed.length; i++) {
        if (!compatible(placed[i], proposal)) blockers.push(i);
        if (blockers.length > 1) break;
      }

      if (blockers.length === 0) {
        // Nothing in the way after all — a later swap freed it up.
        placed.push(proposal);
        done = true;
      } else if (blockers.length === 1 && !placed[blockers[0]].dance.priority) {
        const index = blockers[0];
        const blocker = placed[index];
        const others = placed.filter((_, k) => k !== index);

        for (const alternative of blocker.dance.candidates.slice(
          0,
          MAX_DISPLACEMENT_SCAN,
        )) {
          const moved = { dance: blocker.dance, slot: alternative };
          if (!compatible(moved, proposal)) continue;
          if (!others.every((o) => compatible(o, moved))) continue;

          placed[index] = moved;
          placed.push(proposal);
          done = true;
          break;
        }
      }

      if (done) break;
    }

    if (done) rescued.add(entry.danceId);
  }

  return rescued;
}

/** Greedy ordering can leave an obvious improvement on the table: two dances
 * that would each be better off in the other's slot. Repeatedly try every
 * pair and keep any swap that raises the weighted total. */
function improveBySwapping(
  placed: { dance: DanceToPlace; slot: CandidateSlot }[],
  occupied: OccupiedInterval[],
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
