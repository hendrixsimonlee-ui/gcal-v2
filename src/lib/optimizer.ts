/** Scheduling a whole week at once, instead of one dance at a time.
 *
 * The problem with placing dances one by one is that whichever dance the AD
 * happens to open first takes the best slot, and a dance that only ever had
 * two workable times finds both gone. Solving the week together lets a dance
 * with plenty of options give way to one with almost none, which puts more
 * people in more rooms overall.
 *
 * What it optimises for, in the AD's words: every dance gets a time, as many
 * people as possible are in the room, nobody is repeatedly the one who misses
 * out, and the club's booked hours don't get chopped into holes too short to
 * use.
 *
 * ## What a week costs
 *
 * Everything here is a **cost to be driven down**, never a score to be driven
 * up. Two halves of the same codebase used to count in opposite directions —
 * `scheduling.ts` charged points for problems, this file awarded points for
 * attendance — and every comparison had to be read twice to be sure which way
 * round it was. One direction now: lower is better, everywhere.
 *
 * A finished week is judged on three things, **strictly in this order**:
 *
 * 1. **How many dances got a time.** Never traded. A dance with no practice
 *    doesn't rehearse at all, so a week that places one more dance wins
 *    however much attendance it cost.
 *
 * 2. **Who can't be there.** Weighted absence: choreographers count for more,
 *    and so does anyone who has been the one to miss out before.
 *
 * 3. **Dead minutes in the booked rooms.** A 30-minute hole between two
 *    rehearsals is a room the club is paying for that nobody can use.
 *
 * Those tiers are *lexicographic, not weighted*. Room waste is only consulted
 * between two arrangements where exactly the same people make it. It cannot
 * buy off a single absence at any exchange rate, because there is no exchange
 * rate.
 *
 * How many rehearsals a given person ends up with in one day is **not** scored.
 * It was, briefly. The AD's call is that it doesn't matter: people sign up for
 * the dances they sign up for, and a week that works around how tired somebody
 * might be is a week that fits fewer dances into the rooms the club paid for.
 *
 * That is stronger than the old approach, which capped the tidiness term below
 * one person's attendance and hoped — and got it wrong once, drafting a snug
 * slot over a slot the whole cast was free for. It is also *more* aggressive
 * about gaps than that cap allowed: whenever a hole isn't costing anyone their
 * attendance, the solver will go to any length to close it, and it now counts
 * the wasted minutes rather than flatly noting that a hole exists.
 *
 * ## How it searches
 *
 * **Regret-first insertion.** Rather than a fixed "fewest options first"
 * ordering, the solver asks each unplaced dance what it would lose by waiting:
 * the gap between its best remaining slot and its next two. The dance that
 * stands to lose most goes next. A dance with exactly one workable time has
 * infinite regret and is placed immediately, which is the old
 * most-constrained-first rule falling out as a special case rather than being
 * imposed.
 *
 * **Displacement, up to three deep.** A dance with nowhere left to go asks the
 * dances in its way to move. For a dance that would otherwise go unscheduled
 * this is accepted on legality alone — coverage beats attendance, and that is
 * the AD's rule, not an accident. For an already-placed dance merely wanting a
 * better slot, the chain has to leave the group as a whole better off.
 *
 * **Destroy and repair.** A finished week has a few placements torn out at
 * random and rebuilt by the same regret rule. This shakes loose arrangements
 * no single swap can reach, and it is where most of the late improvement comes
 * from.
 *
 * **Restarts, within a time budget.** All of the above, repeated from
 * different randomised starting points until the clock runs out.
 *
 * Attempt 0 is always the deterministic, noise-free one, and a rival has to be
 * *strictly* better to replace it. So the search is monotone: more time can
 * match or beat the plain answer, never undercut it. The randomness is seeded
 * from the input, so the same week always solves the same way — it varies the
 * *search*, not the answer.
 *
 * Still not provably optimal; an exact solve of an assignment problem this
 * shape is overkill for ~15 dances. But it is comfortably better than
 * first-come ordering, and it is honest about what it will and won't trade.
 */

import type { CandidateSlot } from "@/lib/scheduling";

/** How much a person's prior absences inflate the cost of their missing out.
 * At 1.0 someone who has missed every practice counts double someone who has
 * missed none. Kept at that: high enough to break the pattern of the same
 * person always losing, low enough that it can't outweigh several people. */
export const DEFAULT_DEFICIT_WEIGHT = 1.0;

/** Where ordinary life stops and a pattern starts.
 *
 * Missing one practice in ten is ordinary. Missing a couple across a whole
 * term is ordinary. Each signal is measured from its own floor and saturates
 * at its own ceiling, so neither fires on somebody who just had a bad
 * Tuesday. */
const DEFICIT_FLOOR = 0.2;
const TERM_FLOOR = 2;
const TERM_CEILING = 8;

/** How the two *rate-like* signals share one unit of deficit between them.
 *
 * The per-dance rate carries most of it: it is the direct answer to "is this
 * person always the one left out of *this* dance". The term total is the
 * correction for somebody being squeezed out of everything a little at a
 * time, which looks unremarkable inside any one dance. They add to 1, so
 * these two together can never make a person worth more than
 * `1 + deficitWeight` — two heads at the default. */
const RATE_SHARE = 0.8;
const TERM_SHARE = 0.2;

/** A run of misses of the *same* dance that is still going, which escalates
 * past the ceiling those two share.
 *
 * A percentage can't break a streak. Somebody who has missed three weeks
 * running of one dance caps out at two heads, which ties two people missing
 * for the first time and loses to two-and-a-bit — so the solver sacrifices
 * them a fourth time, which is exactly the pattern the weighting exists to
 * stop. A run is therefore its own step, and it is allowed to outrank people
 * who have genuinely said they're busy.
 *
 * Two in a row must beat two first-time absences, so it is worth 2.5 heads.
 * Three stops at 3.0 — enough to tie three people, deliberately not enough to
 * beat them. Past that the builder starts producing weeks an AD can't defend:
 * a practice at a time most of the cast can't make, to bring back one person.
 *
 * Stored as deficits rather than weights so they scale with the AD's
 * `deficitWeight` setting like everything else. Highest step first. */
export const STREAK_STEPS: { atLeast: number; deficit: number }[] = [
  { atLeast: 3, deficit: 2.0 },
  { atLeast: 2, deficit: 1.5 },
];

function streakDeficit(streak: number): number {
  for (const step of STREAK_STEPS) {
    if (streak >= step.atLeast) return step.deficit;
  }
  return 0;
}

/** Where `x` sits between `floor` and `ceiling`, as 0 to 1. */
function ramp(x: number, floor: number, ceiling: number): number {
  if (x <= floor) return 0;
  if (x >= ceiling) return 1;
  return (x - floor) / (ceiling - floor);
}

/** A choreographer missing costs more than a dancer missing.
 *
 * Having *none* at all is refused outright before the solver ever sees the
 * slot (see `requireChoreographer` in scheduling.ts). This is the other half
 * of the AD's rule — as many as possible should be there.
 *
 * 1.75 rather than the old 1.5, which is the methodology's "3.5 points for a
 * partial choreographer gap" translated into this file's units: `scheduling.ts`
 * charges 2 for a missing person, so 3.5 there is 1.75 dancers here. Two
 * dancers still outweigh one choreographer (2 > 1.75), which is the property
 * that matters — a rehearsal is for the cast. */
const CHOREOGRAPHER_WEIGHT = 1.75;

/** No dance that was already at or above this share of its cast is ever moved
 * below it by an improvement pass.
 *
 * The cost model is a sum, so it happily trades one dance's cast away to buy a
 * bigger gain elsewhere — twelve people down to four is "only" eight, and
 * eight is cheap if it saves nine. But a rehearsal with a third of the cast is
 * not a third of a rehearsal, it is a wasted room, and nothing in a linear sum
 * can see that. So it is a rule rather than a weight.
 *
 * **Coverage overrides it.** Placing a dance that would otherwise go
 * unscheduled ignores this completely — a thin rehearsal still beats no
 * rehearsal, which is the AD's first rule and this must not undo it. */
export const ATTENDANCE_FLOOR = 0.5;

/** The least a missing person can ever cost. `memberWeight` starts here and
 * only ever scales up. Exported so tests can assert relationships against it
 * rather than trusting a comment. */
export const MIN_MEMBER_WEIGHT = 1;

/** A gap this short between two practices in the same room is dead time.
 *
 * Nothing the club runs fits in half an hour once people have walked in and
 * warmed up, so a 30-minute hole between two rehearsals is a booked room being
 * paid for and not used. Rehearsals are 60–90 minutes, so anything under 45
 * counts as stranded — and anything at or over it is bookable, so it costs
 * nothing. */
export const STRANDED_GAP_MINUTES = 45;

/** Floating-point slack. Weighted attendance costs are sums of fractions, so
 * two arrangements that are "the same" can differ in the sixteenth decimal
 * place. Without this the tidiness tier would almost never get consulted. */
const EPSILON = 1e-9;

/** How many of a dance's remaining options get costed when working out its
 * regret. They're kept sorted best-first by this file's own cost, so the
 * winner is near the front; this only exists to stop a dance with 2,000
 * candidate slots dominating the clock. */
const MAX_REGRET_SCAN = 120;

/** How many slots the displacement rescue will look through per dance. Big
 * enough to cover a week at 30-minute increments across every room, small
 * enough that a pathological input can't stall the button. */
const MAX_DISPLACEMENT_SCAN = 400;

/** Moving several dances at once multiplies the search, so the per-dance scan
 * shrinks when it's doing that. */
const MAX_CHAIN_SCAN = 80;

/** At most three dances are ever moved to fit a fourth in.
 *
 * Two used to be the limit, on the grounds that the AD couldn't explain a
 * longer chain to anybody. Three is the methodology's depth and it does
 * unstick real weeks; the explanation problem is handled by naming the dances
 * that moved rather than by refusing to move them. */
const MAX_BLOCKERS_TO_MOVE = 3;

/** Only the first N options of a stuck dance get the expensive multi-dance
 * treatment. They're cost-ordered, so these are the ones worth having. */
const MAX_CHAIN_SLOTS = 40;

/** Cap on deterministic polish passes, so a pathological input can't spin. */
const MAX_IMPROVEMENT_PASSES = 6;

/** How many better-for-this-dance times each placed dance chases per pass. */
const MAX_REALLOCATION_SCAN = 60;

/** Destroy-and-repair rounds per attempt, and how much of the week each round
 * tears out. Small neighbourhoods, many of them: ripping out three placements
 * and rebuilding them is cheap and finds most of what there is to find. */
const LNS_ROUNDS = 40;
const LNS_MIN_DESTROY = 2;
const LNS_MAX_DESTROY = 4;

/** How many randomised restarts to try before settling. The time budget
 * normally bites first; this is the backstop for a tiny week where each
 * attempt costs almost nothing. */
const MAX_RUNS = 4000;

/** Give up once this many attempts in a row have failed to find anything
 * better, scaled to how much there is to search.
 *
 * A three-dance week is solved to death in milliseconds and there is no sense
 * burning the rest of the budget on it. A fifteen-dance week is the opposite:
 * it has an enormous number of arrangements and its last improvement can come
 * hundreds of attempts in.
 *
 * This was a flat 80, and that was wrong. On an 18-dance week it stopped the
 * search after 2.8 seconds of its 10-second budget, at 110 attempts — and
 * running to the full budget (400-odd attempts) found a measurably better
 * week. The flat number existed to keep the test suite quick, which is not a
 * reason to hand the AD a worse schedule. Tiny weeks still stop early; real
 * ones now use the time they were given. */
function attemptsWithoutGainAllowed(danceCount: number): number {
  return Math.max(80, danceCount * 40);
}

/** Wall-clock ceiling across all attempts.
 *
 * Ten seconds, at the AD's request — they'd rather wait and get the best week
 * the search can find than have it stop early. Attempt 0 always completes
 * regardless of the clock, so a slow week still gets a real answer.
 *
 * NOTE: the page that calls this sets `maxDuration` to match. A serverless
 * function that gets killed at ten seconds while the solver is still thinking
 * returns nothing at all, which is much worse than a slightly worse schedule. */
const TIME_BUDGET_MS = 10_000;

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
  /** How much of this dance this person has missed. Key: `${userId}:${danceId}`. */
  missRateByMemberDance: Map<string, number>;
  /** How many of this dance's practices they have missed *in a row*, right
   * now. Key: `${userId}:${danceId}`. A run of three is a different problem
   * from three scattered across a term — it's the one where somebody quietly
   * stops being part of the dance. */
  missStreakByMemberDance: Map<string, number>;
  /** How many practices they have missed this term across every dance they're
   * in. Key: `${userId}`. Somebody being squeezed out of four different dances
   * looks fine in each one and is not fine overall. */
  termMissesByMember: Map<string, number>;
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
  /** How many attempts to make. Defaults to MAX_RUNS, and the time budget
   * normally stops it first. Set to 1 to get the plain deterministic answer —
   * which is what the monotonicity test compares against, and the escape
   * hatch if the search ever needs turning off in a hurry. */
  maxRuns?: number;
  /** Override the wall-clock ceiling. Tests use it to keep the suite quick. */
  timeBudgetMs?: number;
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
  /** More dances are in the way everywhere than the rescue will ever move. */
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
  /** Weighted absence across the week the solver settled on. Lower is better.
   * Only meaningful compared against another solve of the same week. */
  totalCost: number;
  /** Minutes of booked room time left in holes too short to use. */
  deadMinutes: number;
  /** Plain headcount across every placement — what the AD actually cares
   * about. */
  totalExpectedAttendance: number;
  /** How many attempts the search got through inside its budget. Surfaced so
   * a week that only managed one attempt can say so rather than looking the
   * same as one that managed three hundred. */
  attempts: number;
};

/** How much this person missing costs. Someone who keeps missing this dance
 * costs more to leave out, so the solver stops picking the same loser. */
function memberWeight(
  userId: string,
  danceId: string,
  history: AttendanceHistory | undefined,
  deficitWeight: number,
): number {
  if (!history) return MIN_MEMBER_WEIGHT;

  const key = `${userId}:${danceId}`;
  const rate = history.missRateByMemberDance.get(key) ?? 0;
  const streak = history.missStreakByMemberDance.get(key) ?? 0;
  const term = history.termMissesByMember.get(userId) ?? 0;

  // The blend and the streak step are two readings of the same thing, so the
  // worse one wins rather than the two stacking. Stacking would let a bad
  // term-long rate push a three-week run past the 3.0 ceiling that exists to
  // keep the answer defensible.
  const blended =
    RATE_SHARE * ramp(rate, DEFICIT_FLOOR, 1) +
    TERM_SHARE * ramp(term, TERM_FLOOR, TERM_CEILING);

  const deficit = Math.max(blended, streakDeficit(streak));

  if (deficit <= 0) return MIN_MEMBER_WEIGHT;
  return MIN_MEMBER_WEIGHT + deficitWeight * deficit;
}

/** Who we actually expect in the room at this slot.
 *
 * Two lists to read, not one, and missing the second was a real bug: the
 * proposal told the AD everyone was expected at every practice, and the
 * number only corrected itself once the drafts landed in the week checklist.
 *
 * - `conflictedCastMembers` — logged conflicts and clashes with another
 *   dance. Obviously absent. An all-day conflict (someone home for the week)
 *   arrives through here like any other, which is the whole point of having
 *   dropped the separate out-of-town feature.
 * - `excludedCastMembers` — taken out of this dance's week by the AD. Just as
 *   absent, but held in a separate list on purpose: they miss every slot of
 *   the week equally, so charging them would make every option look worse
 *   without changing which one wins. That reasoning is about *ranking*.
 *   Reading it as "not absent" counted them into the headcount the AD was
 *   shown.
 *
 * Counting them here is safe for ranking too: it raises every slot for that
 * dance by the same amount, so the order within a dance is untouched.
 *
 * The one flag deliberately ignored is `historically-absent`. That is a guess
 * about behaviour rather than a statement that somebody can't come, and
 * treating it as an absence would push the solver away from including exactly
 * the people the fairness weighting exists to include. It stays a tie-breaker
 * in the per-dance ranking, which is where it belongs. */
function attendeesFor(dance: DanceToPlace, slot: CandidateSlot): Set<string> {
  const absent = new Set(
    slot.conflictedCastMembers
      .filter((c) => c.reason !== "historically-absent")
      .map((c) => c.userId),
  );
  for (const person of slot.excludedCastMembers) absent.add(person.userId);

  const present = new Set<string>();
  for (const member of dance.cast) {
    if (!absent.has(member.userId)) present.add(member.userId);
  }
  return present;
}

/** What this slot costs this dance in people: everyone who can't be there,
 * weighted up for choreographers and for anyone who keeps missing out. */
function absenceCost(
  dance: DanceToPlace,
  slot: CandidateSlot,
  history: AttendanceHistory | undefined,
  deficitWeight: number,
): number {
  const attendees = attendeesFor(dance, slot);
  let cost = 0;
  for (const member of dance.cast) {
    if (attendees.has(member.userId)) continue;
    const weight = memberWeight(
      member.userId,
      dance.danceId,
      history,
      deficitWeight,
    );
    cost +=
      member.role === "CHOREOGRAPHER" ? weight * CHOREOGRAPHER_WEIGHT : weight;
  }
  return cost;
}

/* ------------------------------------------------------------------ *
 * Prepared dances: everything that doesn't change between attempts,
 * worked out once.
 * ------------------------------------------------------------------ */

type Span = { start: number; end: number };

type Prepared = {
  dance: DanceToPlace;
  castIds: Set<string>;
  /** Per candidate index, aligned with `dance.candidates`. */
  cost: number[];
  attendees: string[][];
  span: Span[];
  /** Candidate indices, best cost first, ties to the earlier slot. Every scan
   * in the solver walks this rather than the raw list, so "the first few
   * options" always means "the best few". */
  order: number[];
  /** `${spaceId}|${start}|${end}` -> candidate index. The swap pass asks "can
   * this dance use that dance's slot?" for every pair on every pass, which is
   * a linear scan through a couple of thousand candidates if you let it. */
  indexByKey: Map<string, number>;
};

function slotKey(slot: CandidateSlot): string {
  return `${slot.spaceId}|${slot.startDateTime.getTime()}|${slot.endDateTime.getTime()}`;
}

function prepare(
  dances: DanceToPlace[],
  history: AttendanceHistory | undefined,
  deficitWeight: number,
): Prepared[] {
  return dances.map((dance) => {
    const cost: number[] = [];
    const attendees: string[][] = [];
    const span: Span[] = [];

    for (const slot of dance.candidates) {
      cost.push(absenceCost(dance, slot, history, deficitWeight));
      attendees.push([...attendeesFor(dance, slot)]);
      span.push({
        start: slot.startDateTime.getTime(),
        end: slot.endDateTime.getTime(),
      });
    }

    const order = dance.candidates.map((_, i) => i).sort((a, b) => {
      if (Math.abs(cost[a] - cost[b]) > EPSILON) return cost[a] - cost[b];
      return span[a].start - span[b].start;
    });

    const indexByKey = new Map<string, number>();
    dance.candidates.forEach((slot, i) => {
      if (!indexByKey.has(slotKey(slot))) indexByKey.set(slotKey(slot), i);
    });

    return {
      dance,
      castIds: new Set(dance.cast.map((m) => m.userId)),
      cost,
      attendees,
      span,
      order,
      indexByKey,
    };
  });
}

/* ------------------------------------------------------------------ *
 * The state of a partly- or fully-built week.
 * ------------------------------------------------------------------ */

type Placed = { prep: Prepared; slotIndex: number };

type State = {
  placed: Placed[];
  /** Weighted absence across every placement. */
  absence: number;
  /** Intervals per room, including the ones the solver can't touch. */
  bySpace: Map<string, Span[]>;
  /** Dead minutes per room, kept in step with `bySpace`. */
  deadBySpace: Map<string, number>;
  dead: number;
};

function deadMinutesIn(spans: Span[]): number {
  if (spans.length < 2) return 0;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let dead = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i].start - sorted[i - 1].end) / 60000;
    // A gap at or over the threshold is bookable, so it isn't wasted. A
    // negative gap can't happen between two legal placements, but occupied
    // rows come from the database and needn't be tidy.
    if (gap > 0 && gap < STRANDED_GAP_MINUTES) dead += gap;
  }
  return dead;
}

function newState(occupied: OccupiedInterval[]): State {
  const bySpace = new Map<string, Span[]>();
  for (const o of occupied) {
    const list = bySpace.get(o.spaceId) ?? [];
    list.push({
      start: o.startDateTime.getTime(),
      end: o.endDateTime.getTime(),
    });
    bySpace.set(o.spaceId, list);
  }

  const deadBySpace = new Map<string, number>();
  let dead = 0;
  for (const [spaceId, spans] of bySpace) {
    const d = deadMinutesIn(spans);
    deadBySpace.set(spaceId, d);
    dead += d;
  }

  return {
    placed: [],
    absence: 0,
    bySpace,
    deadBySpace,
    dead,
  };
}

function spaceIdOf(p: Prepared, slotIndex: number): string {
  return p.dance.candidates[slotIndex].spaceId;
}

function add(state: State, prep: Prepared, slotIndex: number): void {
  state.placed.push({ prep, slotIndex });
  state.absence += prep.cost[slotIndex];

  const spaceId = spaceIdOf(prep, slotIndex);
  const spans = state.bySpace.get(spaceId) ?? [];
  spans.push(prep.span[slotIndex]);
  state.bySpace.set(spaceId, spans);
  const d = deadMinutesIn(spans);
  state.dead += d - (state.deadBySpace.get(spaceId) ?? 0);
  state.deadBySpace.set(spaceId, d);
}

function remove(state: State, index: number): Placed {
  const [entry] = state.placed.splice(index, 1);
  const { prep, slotIndex } = entry;
  state.absence -= prep.cost[slotIndex];

  const spaceId = spaceIdOf(prep, slotIndex);
  const spans = state.bySpace.get(spaceId)!;
  const at = spans.indexOf(prep.span[slotIndex]);
  spans.splice(at, 1);
  const d = deadMinutesIn(spans);
  state.dead += d - (state.deadBySpace.get(spaceId) ?? 0);
  state.deadBySpace.set(spaceId, d);

  return entry;
}

/** What adding this placement would cost, without actually adding it.
 *
 * Built to agree with `add` exactly — same absence figure, same
 * before-and-after dead-minute difference — so the fast path used while
 * inserting and the full recount used while comparing whole weeks can never
 * drift apart. */
function deltaOf(
  state: State,
  prep: Prepared,
  slotIndex: number,
): { absence: number; dead: number } {
  const absence = prep.cost[slotIndex];

  const spaceId = spaceIdOf(prep, slotIndex);
  const spans = state.bySpace.get(spaceId) ?? [];
  const dead =
    deadMinutesIn([...spans, prep.span[slotIndex]]) -
    (state.deadBySpace.get(spaceId) ?? 0);

  return { absence, dead };
}

/* ------------------------------------------------------------------ *
 * Comparing weeks. Placements first, then people, then tidiness — and
 * the tiers never trade against each other.
 * ------------------------------------------------------------------ */

type Score = { placedCount: number; absence: number; dead: number };

function scoreOf(state: State): Score {
  return {
    placedCount: state.placed.length,
    absence: state.absence,
    dead: state.dead,
  };
}

/** Is `a` strictly better than `b`?
 *
 * Each tier is only reached when the one above it is a dead heat, so a
 * tidier week can never be chosen over a better-attended one and a gentler
 * week can never be chosen over either. */
function beats(a: Score, b: Score): boolean {
  if (a.placedCount !== b.placedCount) return a.placedCount > b.placedCount;
  if (Math.abs(a.absence - b.absence) > EPSILON) return a.absence < b.absence;
  return a.dead < b.dead - EPSILON;
}

/* ------------------------------------------------------------------ *
 * Hard constraints.
 * ------------------------------------------------------------------ */

function spansOverlap(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Can these two placements both happen? Two hard rules: one room only holds
 * one dance at a time, and nobody can be in two rooms at once. */
function compatible(
  a: { prep: Prepared; slotIndex: number },
  b: { prep: Prepared; slotIndex: number },
): boolean {
  if (!spansOverlap(a.prep.span[a.slotIndex], b.prep.span[b.slotIndex])) {
    return true;
  }
  if (spaceIdOf(a.prep, a.slotIndex) === spaceIdOf(b.prep, b.slotIndex)) {
    return false;
  }
  for (const id of b.prep.castIds) {
    if (a.prep.castIds.has(id)) return false;
  }
  return true;
}

function fits(state: State, prep: Prepared, slotIndex: number): boolean {
  const proposal = { prep, slotIndex };
  for (const p of state.placed) {
    if (p.prep === prep) continue;
    if (!compatible(p, proposal)) return false;
  }
  return true;
}

function attendeeCount(p: Placed): number {
  return p.prep.attendees[p.slotIndex].length;
}

function meetsFloor(p: Placed): boolean {
  const cast = p.prep.dance.cast.length;
  // A dance with nobody in it can't be hollowed out, and dividing by zero here
  // would give NaN — which compares false against everything and would pin
  // such a dance in place for the rest of the solve.
  if (cast === 0) return true;
  // Counts, not shares: a 2-person dance with 1 present is exactly the floor,
  // and floating-point division is the obvious way to get that wrong.
  return attendeeCount(p) >= cast * ATTENDANCE_FLOOR - EPSILON;
}

/** Would this rearrangement gut a dance?
 *
 * For every dance in both arrangements:
 *
 * - one that met the floor has to still meet it;
 * - one that was already below it must not get worse.
 *
 * A dance that appears only in `after` is exempt — it has just been placed,
 * and coverage beats attendance.
 *
 * Note what the first rule deliberately does *not* say. It is not "attendance
 * must never drop". Applied to a dance comfortably above the floor that would
 * be strict Pareto, which is the exact trap this whole scheme exists to avoid:
 * a dance sitting at full attendance would refuse to move even when the dance
 * it is blocking would gain four people. A healthy dance may fall from 90% to
 * 55%. It may not fall to 40%. Only a dance already under the floor is held to
 * "no worse", so 40% -> 45% is allowed and 40% -> 10% is not. */
function respectsFloor(before: Placed[], after: Placed[]): boolean {
  const was = new Map<string, Placed>();
  for (const p of before) was.set(p.prep.dance.danceId, p);

  for (const p of after) {
    const previous = was.get(p.prep.dance.danceId);
    if (!previous) continue;
    if (meetsFloor(previous)) {
      if (!meetsFloor(p)) return false;
    } else if (attendeeCount(p) < attendeeCount(previous)) {
      return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Regret-first insertion.
 * ------------------------------------------------------------------ */

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
    .flatMap((d) =>
      d.candidates[0] ? [d.candidates[0].startDateTime.getTime()] : [],
    )
    .sort((a, b) => a - b)[0];
  if (earliest !== undefined) {
    hash = Math.imul(hash ^ (earliest & 0xffffffff), 16777619);
  }
  return hash >>> 0;
}

type Option = { slotIndex: number; absence: number; dead: number };

/** The same tier order as `beats`, applied to a single candidate slot. */
function optionBeats(a: Option, b: Option): boolean {
  if (Math.abs(a.absence - b.absence) > EPSILON) return a.absence < b.absence;
  return a.dead < b.dead - EPSILON;
}

/** A single number standing in for an option's cost, used only to size the gap
 * between a dance's first choice and its next ones — regret has to be
 * subtractable, and tiers are not.
 *
 * The scaling keeps the tiers in their proper order at any magnitude this app
 * will ever see: a whole week's dead minutes run to a few hundred, so they
 * cannot climb into a single absence's range. */
function regretKey(o: Option): number {
  return o.absence + o.dead * 1e-6;
}

/** The best few slots still open to this dance, costed against the week as it
 * currently stands. Returns them best-first. */
function bestOptions(
  state: State,
  prep: Prepared,
  feasible: number[],
  want: number,
): Option[] {
  const found: Option[] = [];
  let scanned = 0;

  for (const slotIndex of feasible) {
    if (scanned >= MAX_REGRET_SCAN) break;
    if (!fits(state, prep, slotIndex)) continue;
    scanned++;

    const option: Option = { slotIndex, ...deltaOf(state, prep, slotIndex) };

    // Insertion sort into a list of at most `want`. Ties go to the earlier
    // slot, so a week fills from the front rather than piling onto Sunday —
    // `prep.order` is already sorted that way, so first-seen wins a tie.
    let at = found.length;
    while (at > 0 && optionBeats(option, found[at - 1])) at--;
    if (at < want) {
      found.splice(at, 0, option);
      if (found.length > want) found.pop();
    }
  }

  return found;
}

/** Places every dance in `pending`, hardest-to-satisfy first.
 *
 * "Hardest" is measured as regret: how much worse this dance's second and
 * third choices are than its first. A dance whose only workable time is about
 * to be taken has everything to lose by waiting; a dance with five equally
 * good times has nothing. Placing in that order is what actually gets a week
 * fully scheduled — and a dance down to a single option comes out with
 * infinite regret, so the old "fewest options first" rule falls out of this
 * one rather than having to be bolted on beside it.
 *
 * Dances the AD flagged still go first, always. That is the one instruction
 * they gave the solver by hand and no amount of searching is allowed to
 * quietly drop it.
 *
 * `noise` perturbs the choice on restarts. At 0 this is fully deterministic,
 * which is what attempt 0 uses.
 *
 * Anything with no legal slot left is returned rather than placed; the
 * displacement rescue gets a go at those next. */
function insertByRegret(
  state: State,
  pending: Prepared[],
  noise: number,
  rng: () => number,
): Prepared[] {
  const feasible = new Map<Prepared, number[]>();
  for (const prep of pending) {
    feasible.set(
      prep,
      prep.order.filter((i) => fits(state, prep, i)),
    );
  }

  const left = new Set(pending);
  const stuck: Prepared[] = [];

  while (left.size > 0) {
    const flagged = [...left].filter((p) => p.dance.priority);
    const pool = flagged.length > 0 ? flagged : [...left];

    let choice: { prep: Prepared; option: Option } | null = null;
    let choiceRank = -Infinity;

    for (const prep of pool) {
      const options = bestOptions(state, prep, feasible.get(prep)!, 3);

      if (options.length === 0) {
        // Placements only ever add constraints, so a dance with nothing legal
        // now will still have nothing legal later in this pass.
        left.delete(prep);
        stuck.push(prep);
        continue;
      }

      // Regret over the next two choices, not just the next one: a dance
      // whose second and third options are both poor is in more trouble than
      // one that merely has a close runner-up.
      let regret = 0;
      if (options.length === 1) {
        regret = Infinity;
      } else {
        const first = regretKey(options[0]);
        for (let k = 1; k < options.length; k++) {
          regret += regretKey(options[k]) - first;
        }
      }

      // Break ties toward the dance that is expensive wherever it goes, then
      // let the restarts jiggle it.
      let rank = regret + regretKey(options[0]) * 1e-3;
      if (noise > 0 && Number.isFinite(rank)) rank += rng() * noise;

      if (rank > choiceRank) {
        choiceRank = rank;
        choice = { prep, option: options[0] };
      }
    }

    if (!choice) continue;

    const taken: Placed = {
      prep: choice.prep,
      slotIndex: choice.option.slotIndex,
    };
    add(state, taken.prep, taken.slotIndex);
    left.delete(taken.prep);

    // Everything still waiting loses whatever that placement just ruled out.
    for (const prep of left) {
      const list = feasible.get(prep)!;
      feasible.set(
        prep,
        list.filter((i) => compatible(taken, { prep, slotIndex: i })),
      );
    }
  }

  return stuck;
}

/* ------------------------------------------------------------------ *
 * Displacement: asking placed dances to move.
 * ------------------------------------------------------------------ */

/** Finds somewhere for every one of `moving` to go, such that they and
 * everything in `fixed` can coexist.
 *
 * `fixed` holds the placement we're trying to make room for, plus whichever
 * dances have already been given a new slot earlier in this same rescue — two
 * dances shoved aside must not land on top of each other. */
function relocateAll(
  moving: number[],
  fixed: Placed[],
  placed: Placed[],
  allMoving: number[],
): { index: number; entry: Placed }[] | null {
  if (moving.length === 0) return [];

  const [index, ...rest] = moving;
  const blocker = placed[index];
  const scan = allMoving.length > 1 ? MAX_CHAIN_SCAN : MAX_DISPLACEMENT_SCAN;

  for (const slotIndex of blocker.prep.order.slice(0, scan)) {
    const moved: Placed = { prep: blocker.prep, slotIndex };
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

/** Second chance for dances the insertion pass couldn't fit: ask someone to
 * move.
 *
 * This is the AD's rule made concrete — **a dance being on the schedule at all
 * matters more than everyone making every practice.** Insertion stops as soon
 * as a dance has no free slot left, which is the wrong place to stop: often
 * the dance blocking it has somewhere else perfectly good to go, and moving it
 * turns one unscheduled dance into two scheduled ones. The cost is that the
 * dance which moved may land at a time a couple of its dancers can't make, and
 * that trade is accepted on purpose — no attendance test is applied here, only
 * legality. This is the one place in the solver where net utility is *not* the
 * test, and it is deliberate.
 *
 * Up to three dances are moved to fit a fourth in.
 *
 * A dance the AD flagged as first pick is never the one asked to move. That
 * flag exists precisely to say "this one keeps the slot it chose".
 *
 * Returns the dances it managed to place. */
function rescueByDisplacement(state: State, stuck: Prepared[]): Set<Prepared> {
  const rescued = new Set<Prepared>();

  for (const prep of stuck) {
    if (prep.dance.candidates.length === 0) continue;

    const slots = prep.order.slice(0, MAX_DISPLACEMENT_SCAN);

    for (let s = 0; s < slots.length; s++) {
      const proposal: Placed = { prep, slotIndex: slots[s] };
      const blockers: number[] = [];
      for (let i = 0; i < state.placed.length; i++) {
        if (!compatible(state.placed[i], proposal)) blockers.push(i);
        if (blockers.length > MAX_BLOCKERS_TO_MOVE) break;
      }

      if (blockers.length === 0) {
        // Nothing in the way after all — a later move freed it up.
        add(state, prep, proposal.slotIndex);
        rescued.add(prep);
        break;
      }

      if (blockers.length > MAX_BLOCKERS_TO_MOVE) continue;
      // The AD's flag wins over fitting one more dance in.
      if (blockers.some((i) => state.placed[i].prep.dance.priority)) continue;
      // Moving several is the expensive case, so only the best few options of
      // the stuck dance get it. They're cost-ordered, so those are the ones
      // worth having anyway.
      if (blockers.length > 1 && s >= MAX_CHAIN_SLOTS) continue;

      const moves = relocateAll(blockers, [proposal], state.placed, blockers);
      if (!moves) continue;

      // Apply through the state so absence and dead minutes both stay
      // in step. Removing by descending index keeps the earlier ones valid.
      const sorted = [...moves].sort((a, b) => b.index - a.index);
      for (const move of sorted) remove(state, move.index);
      for (const move of sorted) add(state, move.entry.prep, move.entry.slotIndex);
      add(state, prep, proposal.slotIndex);
      rescued.add(prep);
      break;
    }
  }

  return rescued;
}

/* ------------------------------------------------------------------ *
 * Polish: swaps and reallocation, both judged on the whole week.
 * ------------------------------------------------------------------ */

/** Is this arrangement legal, given that it was legal before `changed` moved?
 *
 * Only the entries that actually moved need re-checking against the rest —
 * everything else was already compatible with everything else and hasn't
 * budged. That turns an O(n²) sweep into a handful of comparisons, which
 * matters because the polish passes run thousands of times. */
function stillLegal(entries: Placed[], changed: number[]): boolean {
  for (const c of changed) {
    for (let k = 0; k < entries.length; k++) {
      if (k === c) continue;
      if (!compatible(entries[c], entries[k])) return false;
    }
  }
  return true;
}

/** Rebuild the week in place from a list of placements. Every derived total —
 * absence, dead minutes — is recomputed by replaying `add`, so a
 * trial arrangement can never leave the running figures out of step with the
 * placements they describe. */
function resetTo(
  state: State,
  occupied: OccupiedInterval[],
  entries: Placed[],
): void {
  const fresh = newState(occupied);
  state.placed = fresh.placed;
  state.absence = fresh.absence;
  state.bySpace = fresh.bySpace;
  state.deadBySpace = fresh.deadBySpace;
  state.dead = fresh.dead;
  for (const e of entries) add(state, e.prep, e.slotIndex);
}

/** Two dances that would each be better off in the other's slot. */
function improveBySwapping(
  state: State,
  occupied: OccupiedInterval[],
): boolean {
  let everImproved = false;

  for (let pass = 0; pass < MAX_IMPROVEMENT_PASSES; pass++) {
    let improved = false;

    for (let i = 0; i < state.placed.length; i++) {
      for (let j = i + 1; j < state.placed.length; j++) {
        const a = state.placed[i];
        const b = state.placed[j];

        // Each dance has to actually be able to use the other's slot.
        const aTakesB = a.prep.indexByKey.get(
          slotKey(b.prep.dance.candidates[b.slotIndex]),
        );
        const bTakesA = b.prep.indexByKey.get(
          slotKey(a.prep.dance.candidates[a.slotIndex]),
        );
        if (aTakesB === undefined || bTakesA === undefined) continue;

        const before = scoreOf(state);
        const base = snapshot(state);
        const trial = base.map((e, k) =>
          k === i
            ? { prep: a.prep, slotIndex: aTakesB }
            : k === j
              ? { prep: b.prep, slotIndex: bTakesA }
              : e,
        );
        if (!stillLegal(trial, [i, j])) continue;
        if (!respectsFloor(base, trial)) continue;

        resetTo(state, occupied, trial);
        if (beats(scoreOf(state), before)) {
          improved = true;
          everImproved = true;
        } else {
          resetTo(state, occupied, base);
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
 * it misses is the one the AD kept spotting: a slot where one dance would have
 * full attendance is sitting under a dance that merely *quite likes* it and
 * has somewhere else perfectly good to go. Nothing to swap — the second
 * dance's alternative is empty, not occupied — so the slot stays with whoever
 * was placed first, which is an accident of ordering rather than a decision.
 *
 * So: for every placed dance, look at the times it would rather have. If one
 * is free, take it. If one other dance is in the way and that dance can move
 * elsewhere, move it — but only when the **week as a whole** comes out ahead.
 * That is the net-utility test: a dance is never shunted somewhere worse
 * unless the dance taking its place gains more than it loses, counting
 * everybody's attendance and the rooms they sit in. A First pick
 * dance is never shunted at all. */
function improveByReallocation(
  state: State,
  occupied: OccupiedInterval[],
): boolean {
  let everImproved = false;

  for (let i = 0; i < state.placed.length; i++) {
    const { prep } = state.placed[i];
    const currentSlot = state.placed[i].slotIndex;

    let tried = 0;
    for (const wanted of prep.order) {
      if (tried >= MAX_REALLOCATION_SCAN) break;
      if (wanted === currentSlot) continue;
      // Only chase times that are genuinely better for this dance's own
      // people. `order` is sorted by exactly that, so once one fails to
      // improve, none of the rest will either.
      //
      // This looks like the Pareto trap and isn't: it only decides which moves
      // are worth *trying*. A dance already at full attendance never needs to
      // initiate — the dance that wants its slot initiates instead, and this
      // pass will happily shunt the first one somewhere worse if the week
      // gains more than it loses. Destroy-and-repair covers what neither
      // direction reaches.
      if (prep.cost[wanted] >= prep.cost[currentSlot] - EPSILON) break;
      tried++;

      const before = scoreOf(state);
      const base = snapshot(state);
      const trial = base.map((e, k) =>
        k === i ? { prep, slotIndex: wanted } : e,
      );

      const blockers: number[] = [];
      for (let k = 0; k < trial.length; k++) {
        if (k === i) continue;
        if (!compatible(trial[k], trial[i])) blockers.push(k);
        if (blockers.length > 1) break;
      }

      let accepted: Placed[] | null = null;

      if (blockers.length === 0) {
        accepted = trial;
      } else if (
        blockers.length === 1 &&
        !trial[blockers[0]].prep.dance.priority
      ) {
        // One dance in the way, and it isn't the AD's first pick. Offer it its
        // own best alternative — `order` is cost-sorted, so the first legal
        // one is the least it can be asked to give up.
        const b = blockers[0];
        const other = trial[b];
        for (const alternative of other.prep.order.slice(0, MAX_CHAIN_SCAN)) {
          if (alternative === other.slotIndex) continue;
          const chain = trial.map((e, k) =>
            k === b ? { prep: other.prep, slotIndex: alternative } : e,
          );
          if (stillLegal(chain, [i, b])) {
            accepted = chain;
            break;
          }
        }
      }

      if (!accepted) continue;
      if (accepted === trial && !stillLegal(trial, [i])) continue;
      if (!respectsFloor(base, accepted)) continue;

      resetTo(state, occupied, accepted);
      // The trade has to leave the **week** better off, not just the dance
      // doing the asking. That is what stops a dance with a mild preference
      // evicting one that would lose more than it gains.
      if (beats(scoreOf(state), before)) {
        everImproved = true;
        break;
      }
      resetTo(state, occupied, base);
    }
  }

  return everImproved;
}

/* ------------------------------------------------------------------ *
 * One attempt, and the search over attempts.
 * ------------------------------------------------------------------ */

type Attempt = { state: State; stuck: Prepared[] };

function snapshot(state: State): { prep: Prepared; slotIndex: number }[] {
  return state.placed.map((p) => ({ prep: p.prep, slotIndex: p.slotIndex }));
}

function restore(
  occupied: OccupiedInterval[],
  entries: { prep: Prepared; slotIndex: number }[],
): State {
  const state = newState(occupied);
  for (const e of entries) add(state, e.prep, e.slotIndex);
  return state;
}

/** Tear a few placements out and rebuild them.
 *
 * Swaps and single moves can only reach arrangements one step away. Ripping
 * out three dances and re-inserting all three by regret reaches arrangements
 * that no single step does — it is the cheapest way to escape a corner the
 * insertion order painted the week into, and in practice it is where most of
 * the late improvement comes from.
 *
 * Every round is kept only if the whole week comes out strictly better, so
 * this can wander but never regress. */
function destroyAndRepair(
  state: State,
  occupied: OccupiedInterval[],
  rng: () => number,
  deadline: number,
): State {
  let best = state;
  let bestScore = scoreOf(best);

  // A four-dance week has nothing like forty rounds' worth of rearrangements
  // in it, and burning them anyway is most of what made the test suite slow.
  const rounds = Math.min(LNS_ROUNDS, Math.max(6, best.placed.length * 4));

  for (let round = 0; round < rounds; round++) {
    if (Date.now() > deadline) break;
    if (best.placed.length < LNS_MIN_DESTROY) break;
    // Perfect: everybody is in every room they should be, nobody's day is
    // stacked, and no booked hour is wasted. Nothing left to look for.
    if (
      bestScore.absence <= EPSILON &&
      bestScore.dead <= EPSILON
    ) {
      break;
    }

    const size = Math.min(
      best.placed.length,
      LNS_MIN_DESTROY +
        Math.floor(rng() * (LNS_MAX_DESTROY - LNS_MIN_DESTROY + 1)),
    );

    const trial = restore(occupied, snapshot(best));
    const torn: Prepared[] = [];
    for (let k = 0; k < size; k++) {
      const at = Math.floor(rng() * trial.placed.length);
      torn.push(remove(trial, at).prep);
    }

    const stuck = insertByRegret(trial, torn, 0.35, rng);
    if (stuck.length > 0) rescueByDisplacement(trial, stuck);
    improveByReallocation(trial, occupied);

    // Without this the torn-and-rebuilt arrangement could reach exactly the
    // hollowed-out week the two passes above now refuse, and be kept because
    // the total improved.
    if (!respectsFloor(best.placed, trial.placed)) continue;

    const score = scoreOf(trial);
    if (beats(score, bestScore)) {
      best = trial;
      bestScore = score;
    }
  }

  return best;
}

/** One complete solve. Pure with respect to the prepared dances, so it can be
 * run as many times as the budget allows. */
function attemptWeek(
  preps: Prepared[],
  occupied: OccupiedInterval[],
  noise: number,
  rng: () => number,
  deadline: number,
): Attempt {
  const state = newState(occupied);

  const placeable = preps.filter((p) => p.dance.candidates.length > 0);
  const stuck = insertByRegret(state, placeable, noise, rng);

  // Coverage beats attendance: rescue what insertion left behind, even at a
  // cost to the people already placed.
  // Whatever it manages to place is reflected in the state; the leftovers are
  // worked out from what's actually on the board at the end, after the polish
  // passes have had their go too.
  rescueByDisplacement(state, stuck);

  for (let pass = 0; pass < MAX_IMPROVEMENT_PASSES; pass++) {
    const swapped = improveBySwapping(state, occupied);
    const moved = improveByReallocation(state, occupied);
    if (!swapped && !moved) break;
  }

  const polished = destroyAndRepair(state, occupied, rng, deadline);

  const placedPreps = new Set(polished.placed.map((p) => p.prep));
  return {
    state: polished,
    stuck: preps.filter((p) => !placedPreps.has(p)),
  };
}

export function solveWeek(input: OptimizerInput): OptimizerResult {
  const deficitWeight = input.deficitWeight ?? DEFAULT_DEFICIT_WEIGHT;
  const { history } = input;
  const occupied = input.occupied ?? [];

  const preps = prepare(input.dances, history, deficitWeight);
  const rng = makeRng(seedFrom(input.dances));

  const budget = input.timeBudgetMs ?? TIME_BUDGET_MS;
  const deadline = Date.now() + budget;

  // Attempt 0 is deterministic and noise-free, so the plain answer is the
  // floor. Every later attempt has to be *strictly* better to replace it,
  // which makes the search monotone: more time can match or beat what came
  // before, never undercut it.
  let best = attemptWeek(preps, occupied, 0, rng, deadline);
  let bestScore = scoreOf(best.state);
  let attempts = 1;

  const maxRuns = Math.max(1, input.maxRuns ?? MAX_RUNS);
  const stagnationLimit = attemptsWithoutGainAllowed(input.dances.length);
  let sinceGain = 0;

  while (attempts < maxRuns && sinceGain < stagnationLimit) {
    if (Date.now() > deadline) break;
    // Nothing left to find: every dance has a time, everybody can make it,
    // and no room has a hole in it.
    if (
      best.stuck.length === 0 &&
      bestScore.absence <= EPSILON &&
      bestScore.dead <= EPSILON
    ) {
      break;
    }

    const attempt = attemptWeek(preps, occupied, 0.6, rng, deadline);
    attempts++;
    const score = scoreOf(attempt.state);
    if (beats(score, bestScore)) {
      best = attempt;
      bestScore = score;
      sinceGain = 0;
    } else {
      sinceGain++;
    }
  }

  const placements: Placement[] = best.state.placed.map(
    ({ prep, slotIndex }) => {
      const slot = prep.dance.candidates[slotIndex];
      const attendees = new Set(prep.attendees[slotIndex]);
      return {
        danceId: prep.dance.danceId,
        danceName: prep.dance.danceName,
        slot,
        expectedCount: attendees.size,
        castSize: prep.dance.cast.length,
        missingUserIds: prep.dance.cast
          .map((m) => m.userId)
          .filter((id) => !attendees.has(id)),
      };
    },
  );

  // Report in the order the week runs, not the order they were solved.
  placements.sort(
    (a, b) => a.slot.startDateTime.getTime() - b.slot.startDateTime.getTime(),
  );

  // Explain the leftovers against the arrangement actually being shown, not
  // against some attempt that was thrown away.
  const unplaced = best.stuck.map((prep) => diagnose(prep, best.state.placed));

  return {
    placements,
    unplaced,
    totalCost: bestScore.absence,
    deadMinutes: bestScore.dead,
    totalExpectedAttendance: placements.reduce(
      (sum, p) => sum + p.expectedCount,
      0,
    ),
    attempts,
  };
}

/** Works out *which* kind of stuck a dance is, once the rescue pass has
 * failed, and says so in a sentence naming the thing to change.
 *
 * These are genuinely different problems with genuinely different fixes, and
 * the AD can't tell them apart from the schedule. In particular
 * `cast-double-booked` is the one that looks like a bug and isn't: those times
 * show on the dance's own page — marked, because the AD may still want to see
 * them — while the builder can't use them, since nobody can be in two rooms at
 * once. Saying that out loud is the difference between "the tool is broken"
 * and "of course, Maya's in Bhangra then". */
function diagnose(prep: Prepared, placed: Placed[]): Unplaced {
  const { dance } = prep;
  const base = {
    danceId: dance.danceId,
    danceName: dance.danceName,
  };

  if (dance.candidates.length === 0) {
    return {
      ...base,
      cause: dance.blockedByChoreographerGap ? "no-choreographer" : "no-slots",
      blockingDanceNames: [],
      reason: dance.blockedByChoreographerGap
        ? "There are open times this week, but no choreographer for this dance can make any of them. A practice with nobody to run it is never drafted, so this one needs a choreographer to free something up — or excuse them for the week if it should go ahead without them."
        : "Nowhere to put it. No room is booked for long enough this week, or every open hour is already taken by a practice.",
    };
  }

  const blockingNames = new Set<string>();
  let sawFirstPickBlocker: string | null = null;
  let everySlotTangled = true;
  let sawRoomClash = false;
  let sawCastClash = false;

  for (let slotIndex = 0; slotIndex < dance.candidates.length; slotIndex++) {
    const proposal = { prep, slotIndex };
    const blockers = placed.filter((p) => !compatible(p, proposal));
    if (blockers.length === 0) continue;
    // "Tangled" means more dances in the way than the rescue will ever move.
    if (blockers.length <= MAX_BLOCKERS_TO_MOVE) everySlotTangled = false;

    for (const blocker of blockers) {
      blockingNames.add(blocker.prep.dance.danceName);
      if (
        spaceIdOf(blocker.prep, blocker.slotIndex) ===
        dance.candidates[slotIndex].spaceId
      ) {
        sawRoomClash = true;
      } else {
        sawCastClash = true;
      }
    }

    if (blockers.length <= MAX_BLOCKERS_TO_MOVE) {
      const flagged = blockers.find((b) => b.prep.dance.priority);
      if (flagged) sawFirstPickBlocker ??= flagged.prep.dance.danceName;
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
    reason = `Every open time has four or more dances in the way (${list}), and at most three are ever moved aside. Tick First pick on this dance and rebuild so it chooses before the others.`;
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

  return { ...base, cause, reason, blockingDanceNames: names };
}

/** Turns raw attendance counts into the three signals the solver weights by.
 *
 * `streak` and `termMisses` are optional so a caller with only the per-dance
 * tally still gets sensible behaviour — the two corrections simply read as
 * zero, which is what they were before they existed. */
export function buildHistory(
  rows: {
    userId: string;
    danceId: string;
    missed: number;
    total: number;
    /** Consecutive misses of this dance, counting back from the most recent
     * practice. */
    streak?: number;
  }[],
  termMisses: { userId: string; missed: number }[] = [],
): AttendanceHistory {
  const missRateByMemberDance = new Map<string, number>();
  const missStreakByMemberDance = new Map<string, number>();

  for (const row of rows) {
    if (row.total <= 0) continue;
    const key = `${row.userId}:${row.danceId}`;
    missRateByMemberDance.set(key, row.missed / row.total);
    if (row.streak) missStreakByMemberDance.set(key, row.streak);
  }

  const termMissesByMember = new Map<string, number>();
  for (const row of termMisses) termMissesByMember.set(row.userId, row.missed);

  return {
    missRateByMemberDance,
    missStreakByMemberDance,
    termMissesByMember,
  };
}
