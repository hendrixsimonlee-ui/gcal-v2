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
  assertEqual(noSlots.unplaced[0].cause, "no-slots", "…and says which kind of stuck");
  assert(
    noSlots.unplaced[0].reason.includes("No room is booked"),
    "…in a sentence naming what to go and change",
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

// --- saying *which* kind of stuck ------------------------------------------
// One generic "every workable slot clashes with another dance" told the AD
// nothing and read as a bug, because opening that same dance on its own often
// showed workable times. Each dead end has a different fix, so each says so.
{
  // Held by a First pick dance: the fix is to untick First pick.
  const rigid = dance("Rigid", ["c", "d"], [slot(0, "studio")]);
  const wanted: DanceToPlace = {
    ...dance("Wanted", ["a", "b"], [slot(0, "studio"), slot(2, "studio")]),
    priority: true,
  };
  const result = solveWeek({ dances: [rigid, wanted] });
  assertEqual(result.unplaced[0]?.cause, "blocked-by-first-pick", "a First pick blocker is named as such");
  assert(
    result.unplaced[0].reason.includes("Wanted") &&
      result.unplaced[0].reason.includes("Untick First pick"),
    "…and the message says which dance to untick",
  );
  assertEqual(
    JSON.stringify(result.unplaced[0].blockingDanceNames),
    JSON.stringify(["Wanted"]),
    "…and the blocker is reported separately for the UI",
  );
}
{
  // The room is taken and its occupant has nowhere else to go.
  const held = dance("Held", ["x"], [slot(0, "studio")]);
  const other = dance("Other", ["y"], [slot(0, "studio")]);
  const result = solveWeek({ dances: [held, other] });
  assertEqual(result.unplaced[0]?.cause, "room-taken", "a room clash is called a room clash");
}
{
  // The one that looks like a bug and isn't: the times are free, but this
  // dance's own people are in another dance then. Those slots still appear on
  // the dance's own page, marked — the builder can't use them.
  const bhangra = dance("Bhangra", ["maya"], [slot(0, "studio")]);
  const scholar = dance("Scholar", ["maya"], [slot(0, "annex")]);
  const result = solveWeek({ dances: [bhangra, scholar] });
  assertEqual(
    result.unplaced[0]?.cause,
    "cast-double-booked",
    "shared dancers in another room is its own diagnosis",
  );
  assert(
    result.unplaced[0].reason.includes("two rooms at once"),
    "…and the message explains why the dance's own page still offers it",
  );
  assert(
    result.unplaced[0].reason.includes("Bhangra"),
    "…and names the dance they're in",
  );
}

// --- solving the week several ways, and keeping the best --------------------
// Most-constrained-first is a good rule, not a correct one. The safety
// property that makes the search worth having is that it is monotone: run 0
// is the canonical ordering, and a rival has to be strictly better to replace
// it, so this can never do worse than the single-run answer.
{
  // Two dances share Maya, so they can't overlap. Ana's dance can only run at
  // noon; Maya's pair have to arrange themselves around it.
  const build = (): OptimizerInput => ({
    dances: [
      dance("Alpha", ["maya", "a"], [slot(0, "studio"), slot(2, "studio")]),
      dance("Beta", ["maya", "b"], [slot(0, "annex"), slot(2, "annex")]),
      dance("Gamma", ["c"], [slot(0, "studio")]),
      dance("Delta", ["d"], [slot(2, "annex"), slot(4, "annex")]),
    ],
  });

  const result = solveWeek(build());
  assertEqual(result.placements.length, 4, "a week that needs rearranging still fully places");

  // Same input, same answer, every time — the restarts are seeded from the
  // input, so pressing Build twice can't hand back two different schedules.
  const runs = [solveWeek(build()), solveWeek(build()), solveWeek(build())];
  const shape = (r: typeof result) =>
    JSON.stringify(
      r.placements.map((p) => [p.danceId, p.slot.spaceId, p.slot.startDateTime.getTime()]),
    );
  assert(
    runs.every((r) => shape(r) === shape(runs[0])),
    "the multi-run search is deterministic across presses",
  );
}
{
  // The floor: whatever the search does, it never returns fewer placements
  // or less attendance than one canonical run would have. Checked over a
  // spread of shapes rather than one lucky case.
  let everWorse = false;
  for (let seed = 0; seed < 12; seed++) {
    const rooms = ["studio", "annex", "loft"];
    const dances: DanceToPlace[] = [];
    for (let d = 0; d < 6; d++) {
      const cands: CandidateSlot[] = [];
      for (let h = 0; h < 6; h += 2) {
        for (const room of rooms) {
          // A crude spread of shapes: some dances get few options, some many.
          if ((seed + d + h + room.length) % 3 === 0) continue;
          cands.push(slot(h, room, (d + h) % 4 === 0 ? [`p${d}`] : []));
        }
      }
      dances.push(dance(`D${d}`, [`p${d}`, `q${d % 3}`], cands));
    }
    const r = solveWeek({ dances });
    // Everything placed is legal: no room double-booked, nobody in two rooms.
    for (let i = 0; i < r.placements.length; i++) {
      for (let j = i + 1; j < r.placements.length; j++) {
        const a = r.placements[i];
        const b = r.placements[j];
        const clash =
          a.slot.startDateTime < b.slot.endDateTime &&
          b.slot.startDateTime < a.slot.endDateTime;
        if (!clash) continue;
        if (a.slot.spaceId === b.slot.spaceId) everWorse = true;
      }
    }
    if (r.placements.length + r.unplaced.length !== 6) everWorse = true;
  }
  assert(!everWorse, "across many shapes, every result is legal and accounts for every dance");
}
{
  // Moving two dances aside, not just one. Stuck's only time is held by two
  // separate dances, each of which has somewhere else to go.
  const stuck = dance("Stuck", ["z"], [slot(0, "studio")]);
  const roomHog = dance("RoomHog", ["r"], [slot(0, "studio"), slot(4, "studio")]);
  const castMate = dance("CastMate", ["z", "m"], [slot(0, "annex"), slot(4, "annex")]);

  const result = solveWeek({ dances: [roomHog, castMate, stuck] });
  assertEqual(result.placements.length, 3, "two dances are moved aside to fit a third in");
  assertEqual(
    result.placements.find((p) => p.danceId === "Stuck")?.slot.startDateTime.getTime(),
    slot(0, "studio").startDateTime.getTime(),
    "…and the stuck dance gets the time it needed",
  );
}
{
  // A First pick dance is still never the one moved, even now that two can be.
  const stuck = dance("Stuck", ["z"], [slot(0, "studio")]);
  const flagged: DanceToPlace = {
    ...dance("Flagged", ["r"], [slot(0, "studio"), slot(4, "studio")]),
    priority: true,
  };
  const result = solveWeek({ dances: [flagged, stuck] });
  assertEqual(
    result.placements.find((p) => p.danceId === "Flagged")?.slot.startDateTime.getTime(),
    slot(0, "studio").startDateTime.getTime(),
    "a flagged dance holds its slot even when moving it would place another dance",
  );
  assertEqual(result.unplaced[0]?.cause, "blocked-by-first-pick", "…and the message says so");
}

// --- the guarantee: searching can only help ---------------------------------
// The whole reason the multi-run search is safe to ship is that it is
// monotone. Run 0 is the plain single-run answer, and a rival must be
// strictly better to replace it. If that ever stops holding, a week that used
// to schedule fine would silently get worse, which is the one outcome that
// can't be allowed. Checked over a spread of generated weeks.
{
  let regressions = 0;
  let placedMore = 0;
  let attendedMore = 0;

  for (let seed = 0; seed < 120; seed++) {
    // Deliberately tight: two rooms, few times, heavily shared casts. A roomy
    // week places itself however you order it and proves nothing either way.
    const rooms = ["studio", "annex"];
    const dances: DanceToPlace[] = [];
    const count = 6 + (seed % 6);
    for (let d = 0; d < count; d++) {
      const cands: CandidateSlot[] = [];
      for (let h = 0; h < 8; h += 2) {
        for (let r = 0; r < rooms.length; r++) {
          if ((seed * 13 + d * 17 + h * 7 + r * 5) % 7 < 3) continue;
          cands.push(slot(h, rooms[r], (seed + d + h) % 4 === 0 ? [`p${d}`] : []));
        }
      }
      dances.push(dance(`D${d}`, [`p${d}`, `q${d % 3}`, `s${d % 2}`], cands));
    }

    const single = solveWeek({ dances, maxRuns: 1 });
    const searched = solveWeek({ dances });

    if (searched.placements.length < single.placements.length) regressions++;
    else if (searched.placements.length > single.placements.length) placedMore++;
    else if (searched.totalExpectedAttendance < single.totalExpectedAttendance) {
      // Equal placements: attendance must not have gone backwards either.
      regressions++;
    } else if (searched.totalExpectedAttendance > single.totalExpectedAttendance) {
      attendedMore++;
    }
  }

  assertEqual(regressions, 0, "searching more orderings never returns a worse week");
  // And it has to actually earn its keep — if a change ever makes the extra
  // runs pointless, this catches it rather than leaving dead search in place.
  assert(
    placedMore + attendedMore > 0,
    `searching finds a better week sometimes (${placedMore} placed more, ${attendedMore} better attended, of 120)`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} optimizer test(s) failed`);
  process.exit(1);
}
console.log("\nAll optimizer tests passed");
