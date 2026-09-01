import {
  buildHistory,
  solveWeek,
  type DanceToPlace,
  type OptimizerInput,
} from "./optimizer";
import type { CandidateSlot } from "./scheduling";

let failures = 0;

function assert(cond: boolean, msg: string) {
  if (cond) console.log(`PASS: ${msg}`);
  else {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  assert(
    actual === expected,
    `${msg}${actual === expected ? "" : ` (got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)})`}`,
  );
}

/** A slot at a given hour offset from a fixed Monday, in a named room. */
function slot(
  hourOffset: number,
  spaceId: string,
  conflicted: string[] = [],
): CandidateSlot {
  const start = new Date(Date.UTC(2026, 8, 14, 12 + hourOffset, 0, 0));
  const end = new Date(start.getTime() + 90 * 60000);
  return {
    startDateTime: start,
    endDateTime: end,
    spaceId,
    spaceName: spaceId,
    score: conflicted.length,
    conflictedCastMembers: conflicted.map((userId) => ({
      userId,
      name: userId,
      points: 2,
      reason: "unexcused-conflict" as const,
    })),
    awayCastMembers: [],
    choreographersMissing: 0,
    noChoreographerAvailable: false,
  };
}

function dance(
  danceId: string,
  cast: string[],
  candidates: CandidateSlot[],
): DanceToPlace {
  return {
    danceId,
    danceName: danceId,
    cast: cast.map((userId) => ({ userId, role: "DANCER" as const })),
    candidates,
  };
}

// --- the core reason this exists --------------------------------------------
// Placing dances in the order they happen to appear gives the first dance the
// only slot the second one could have used. Most-constrained-first doesn't.
{
  const flexible = dance("Flexible", ["a", "b"], [
    slot(0, "studio"),
    slot(2, "studio"),
    slot(4, "studio"),
  ]);
  const rigid = dance("Rigid", ["c", "d"], [slot(0, "studio")]);

  const result = solveWeek({ dances: [flexible, rigid] });
  assertEqual(result.placements.length, 2, "both dances get placed");
  assertEqual(result.unplaced.length, 0, "nothing is left unplaced");

  const rigidPlacement = result.placements.find((p) => p.danceId === "Rigid");
  assertEqual(
    rigidPlacement?.slot.startDateTime.getTime(),
    slot(0, "studio").startDateTime.getTime(),
    "the dance with only one option keeps it",
  );
}

// --- hard constraints -------------------------------------------------------
{
  // One room, one time, two dances. Only one can happen.
  const a = dance("A", ["a"], [slot(0, "studio")]);
  const b = dance("B", ["b"], [slot(0, "studio")]);
  const result = solveWeek({ dances: [a, b] });
  assertEqual(result.placements.length, 1, "a room can't hold two dances");
  assertEqual(result.unplaced.length, 1, "the other is reported as unplaced");
  assert(
    result.unplaced[0].reason.length > 0,
    "…with a reason the AD can act on",
  );
}

{
  // Different rooms, same time, but a shared dancer.
  const a = dance("A", ["shared", "a"], [slot(0, "studioA")]);
  const b = dance("B", ["shared", "b"], [slot(0, "studioB")]);
  const result = solveWeek({ dances: [a, b] });
  assertEqual(
    result.placements.length,
    1,
    "a dancer can't be in two rooms at once",
  );
}

{
  // Different rooms, same time, no overlap in cast — both are fine.
  const a = dance("A", ["a1", "a2"], [slot(0, "studioA")]);
  const b = dance("B", ["b1", "b2"], [slot(0, "studioB")]);
  const result = solveWeek({ dances: [a, b] });
  assertEqual(
    result.placements.length,
    2,
    "two rooms at once is fine with separate casts",
  );
}

// --- maximising attendance --------------------------------------------------
{
  const d = dance(
    "Solo",
    ["a", "b", "c", "d"],
    [slot(0, "studio", ["a", "b", "c"]), slot(2, "studio", ["a"])],
  );
  const result = solveWeek({ dances: [d] });
  assertEqual(
    result.placements[0].expectedCount,
    3,
    "picks the slot where more people can come",
  );
  assertEqual(result.placements[0].castSize, 4, "reports the full cast size");
  assertEqual(
    result.placements[0].missingUserIds.join(","),
    "a",
    "names who can't make it",
  );
  assertEqual(
    result.totalExpectedAttendance,
    3,
    "total attendance is a plain headcount",
  );
}

// --- the fairness rule ------------------------------------------------------
// Two slots, each excluding exactly one person, so raw attendance ties. The
// tie must break toward including whoever has been missing out.
{
  const d = dance(
    "Fair",
    ["regular", "keeps-missing"],
    [
      slot(0, "studio", ["keeps-missing"]),
      slot(2, "studio", ["regular"]),
    ],
  );

  const noHistory = solveWeek({ dances: [d] });
  assertEqual(
    noHistory.placements[0].slot.startDateTime.getTime(),
    slot(0, "studio").startDateTime.getTime(),
    "with no history, the tie goes to the earlier slot",
  );

  const withHistory = solveWeek({
    dances: [d],
    history: buildHistory([
      { userId: "keeps-missing", danceId: "Fair", missed: 4, total: 5 },
      { userId: "regular", danceId: "Fair", missed: 0, total: 5 },
    ]),
  });
  assertEqual(
    withHistory.placements[0].missingUserIds.join(","),
    "regular",
    "someone who keeps missing this dance is the one included",
  );
}

// A single person's deficit must not outweigh several other people.
{
  const d = dance(
    "Weighting",
    ["keeps-missing", "x", "y", "z"],
    [
      slot(0, "studio", ["keeps-missing"]), // 3 attend
      slot(2, "studio", ["x", "y", "z"]), // 1 attends, the deficit one
    ],
  );
  const result = solveWeek({
    dances: [d],
    history: buildHistory([
      { userId: "keeps-missing", danceId: "Weighting", missed: 5, total: 5 },
    ]),
  });
  assertEqual(
    result.placements[0].expectedCount,
    3,
    "fairness breaks ties but never beats three people against one",
  );
}

// --- history is scoped to the dance -----------------------------------------
{
  const d = dance(
    "Scoped",
    ["p", "q"],
    [slot(0, "studio", ["p"]), slot(2, "studio", ["q"])],
  );
  const result = solveWeek({
    dances: [d],
    // p misses a *different* dance a lot; it must not sway this one.
    history: buildHistory([
      { userId: "p", danceId: "SomethingElse", missed: 5, total: 5 },
    ]),
  });
  assertEqual(
    result.placements[0].slot.startDateTime.getTime(),
    slot(0, "studio").startDateTime.getTime(),
    "absence from another dance doesn't influence this one",
  );
}

// --- a historical hint is not an absence ------------------------------------
// The per-dance engine flags people as "historically-absent" to break ties in
// its own ranking. If the optimizer treated that as "can't attend" it would
// steer away from including exactly the people the fairness weighting exists
// to include — the two rules would fight each other.
{
  const hinted: CandidateSlot = {
    ...slot(0, "studio"),
    conflictedCastMembers: [
      { userId: "skips-a-lot", name: "skips-a-lot", points: 0.8, reason: "historically-absent" },
    ],
  };
  const realConflict = slot(2, "studio", ["skips-a-lot"]);

  const d = dance("Hints", ["skips-a-lot", "other"], [hinted, realConflict]);
  const result = solveWeek({ dances: [d] });

  assertEqual(
    result.placements[0].expectedCount,
    2,
    "a historical hint doesn't reduce the expected headcount",
  );
  assertEqual(
    result.placements[0].missingUserIds.length,
    0,
    "…and nobody is listed as missing because of one",
  );
  assertEqual(
    result.placements[0].slot.startDateTime.getTime(),
    hinted.startDateTime.getTime(),
    "a real conflict still outweighs a slot with only a hint",
  );
}

// --- swap improvement -------------------------------------------------------
// Greedy order places Rigid first into the slot that suits Flexible far
// better; the swap pass should undo that where it's legal.
{
  const early = slot(0, "studio");
  const late = slot(4, "studio");

  const one = dance("One", ["a", "b", "c"], [
    { ...early, conflictedCastMembers: [] } as CandidateSlot,
    { ...late, conflictedCastMembers: early.conflictedCastMembers } as CandidateSlot,
  ]);
  const two: DanceToPlace = {
    danceId: "Two",
    danceName: "Two",
    cast: [{ userId: "d", role: "DANCER" }],
    candidates: [early, late],
  };

  const result = solveWeek({ dances: [one, two] });
  assertEqual(result.placements.length, 2, "both still placed after swapping");
  assert(
    result.totalExpectedAttendance >= 4,
    "the swap pass doesn't lose attendance",
  );
}

// --- degenerate input -------------------------------------------------------
{
  const empty = solveWeek({ dances: [] });
  assertEqual(empty.placements.length, 0, "no dances means no placements");
  assertEqual(empty.totalExpectedAttendance, 0, "…and no attendance");

  const noSlots = solveWeek({ dances: [dance("Stuck", ["a"], [])] });
  assertEqual(noSlots.unplaced.length, 1, "a dance with no slots is unplaced");
  assert(
    noSlots.unplaced[0].reason.includes("No slot works"),
    "…and says why",
  );
}

// --- determinism ------------------------------------------------------------
{
  const build = (): OptimizerInput => ({
    dances: [
      dance("A", ["a", "b"], [slot(0, "s1"), slot(2, "s1")]),
      dance("B", ["c"], [slot(0, "s1"), slot(2, "s2")]),
      dance("C", ["d", "e"], [slot(2, "s2"), slot(4, "s1")]),
    ],
  });
  const first = solveWeek(build());
  const second = solveWeek(build());
  assertEqual(
    JSON.stringify(first.placements.map((p) => [p.danceId, p.slot.spaceId])),
    JSON.stringify(second.placements.map((p) => [p.danceId, p.slot.spaceId])),
    "the same week solves the same way twice",
  );
}


// --- priority: the AD overrides most-constrained-first ----------------------
// Most-constrained-first is right by default, but sometimes the AD knows
// something the data doesn't. A dance marked priority picks before everything
// else, even when another dance has fewer options and would normally go first.
{
  const rigid = dance("Rigid", ["c", "d"], [slot(0, "studio")]);
  const wanted: DanceToPlace = {
    ...dance("Wanted", ["a", "b"], [slot(0, "studio"), slot(2, "studio")]),
    priority: true,
  };

  const result = solveWeek({ dances: [rigid, wanted] });
  const wantedPlacement = result.placements.find((p) => p.danceId === "Wanted");
  assertEqual(
    wantedPlacement?.slot.startDateTime.getTime(),
    slot(0, "studio").startDateTime.getTime(),
    "a priority dance takes the contested slot first",
  );
  assertEqual(
    result.unplaced[0]?.danceId,
    "Rigid",
    "...even though the other dance had fewer options and would normally win",
  );
}

// Without the flag, the same pair resolves the usual way.
{
  const rigid = dance("Rigid", ["c", "d"], [slot(0, "studio")]);
  const wanted = dance("Wanted", ["a", "b"], [slot(0, "studio"), slot(2, "studio")]);
  const result = solveWeek({ dances: [rigid, wanted] });
  assertEqual(result.placements.length, 2, "unflagged, both still get placed");
  assertEqual(
    result.placements.find((p) => p.danceId === "Rigid")?.slot.startDateTime.getTime(),
    slot(0, "studio").startDateTime.getTime(),
    "...with the constrained dance keeping its only option",
  );
}

// Two priority dances still sort sensibly against each other.
{
  const a: DanceToPlace = {
    ...dance("BothA", ["a"], [slot(0, "studio"), slot(2, "studio")]),
    priority: true,
  };
  const b: DanceToPlace = {
    ...dance("BothB", ["b"], [slot(0, "studio")]),
    priority: true,
  };
  const result = solveWeek({ dances: [a, b] });
  assertEqual(
    result.placements.length,
    2,
    "two priority dances are ordered among themselves, not fought over",
  );
}


// --- coverage beats attendance ---------------------------------------------
// The AD's rule: a dance with no rehearsal at all is worse than a rehearsal
// two people can't make. Greedy stops as soon as a dance has no free slot, so
// anything left over gets a second pass in which a dance already placed is
// asked to move — accepted even when the move costs attendance.
{
  // Pat picks the studio at noon, Quinn the annex at noon, and Stuck — which
  // can only use one of those two rooms at noon — is left with nothing.
  const pat = dance("Pat", ["p1", "p2"], [
    slot(0, "studio"),
    slot(3, "studio", ["p2"]), // Pat's fallback costs Pat a dancer
  ]);
  const quinn = dance("Quinn", ["q"], [slot(0, "annex"), slot(3, "annex")]);
  const stuck = dance("Stuck", ["z"], [slot(0, "studio"), slot(0, "annex")]);

  const result = solveWeek({ dances: [pat, quinn, stuck] });
  assertEqual(result.placements.length, 3, "the dance greedy gave up on gets rescued");
  assertEqual(result.unplaced.length, 0, "so nothing is reported as unschedulable");
  assert(
    result.placements.some((p) => p.danceId === "Stuck"),
    "and it is specifically the stranded dance that got a time",
  );
}

// --- packing rooms: no stranded half-hours ----------------------------------
// The club only has so many booked hours. Half an hour between two rehearsals
// is a room being paid for and not used.
function booked(spaceId: string, startHour: number, minutes: number) {
  const startDateTime = new Date(Date.UTC(2026, 8, 14, 12, 0, 0));
  startDateTime.setUTCMinutes(startDateTime.getUTCMinutes() + startHour * 60);
  return {
    spaceId,
    startDateTime,
    endDateTime: new Date(startDateTime.getTime() + minutes * 60000),
  };
}
{
  // Nothing to choose between these on attendance, and the earlier one would
  // normally win — but it butts straight up against a practice already in the
  // room, so it wins by more.
  const flush = solveWeek({
    dances: [dance("Solo", ["a"], [slot(0, "studio"), slot(2, "studio")])],
    // 15:30–17:00, i.e. starting exactly when the 14:00 slot ends.
    occupied: [booked("studio", 3.5, 90)],
  });
  assertEqual(
    flush.placements[0]?.slot.startDateTime.getTime(),
    slot(2, "studio").startDateTime.getTime(),
    "a slot that sits flush against an existing practice is preferred",
  );
}
{
  // 14:00 would leave exactly 30 minutes after the noon practice — dead time.
  // 16:00 leaves a real gap somebody could still book into.
  const gap = solveWeek({
    dances: [dance("Solo", ["a"], [slot(2, "studio"), slot(4, "studio")])],
    occupied: [booked("studio", 0, 90)],
  });
  assertEqual(
    gap.placements[0]?.slot.startDateTime.getTime(),
    slot(4, "studio").startDateTime.getTime(),
    "a slot that would strand half an hour of a booked room is avoided",
  );
}
{
  // …but tidiness never outranks people. The flush slot here costs two
  // dancers, so the one that leaves a gap wins.
  const people = solveWeek({
    dances: [
      dance("Trio", ["a", "b", "c"], [
        slot(0, "studio"),
        slot(2, "studio", ["b", "c"]),
      ]),
    ],
    occupied: [booked("studio", 3.5, 90)],
  });
  assertEqual(
    people.placements[0]?.slot.startDateTime.getTime(),
    slot(0, "studio").startDateTime.getTime(),
    "packing the room never beats having people in it",
  );
}

if (failures > 0) {
  console.error(`\n${failures} optimizer test(s) failed`);
  process.exit(1);
}
console.log("\nAll optimizer tests passed");
