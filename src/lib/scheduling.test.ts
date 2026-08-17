import { generateCandidateSlots, type SchedulingInput } from "./scheduling";
import { startOfWeek, addDays } from "./dates";
import { appDateKey, minutesIntoAppDay, zonedParts } from "./timezone";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("PASS:", msg);
  }
}

const nextMonday = addDays(startOfWeek(new Date()), 7);
const dayOfWeek = zonedParts(nextMonday).weekday;

/** How a one-off override's date is held in a `@db.Date` column: the Eastern
 * calendar day it applies to, anchored at UTC midnight. Reading the instant
 * with local getters instead would put a Monday closure on the Sunday for a
 * server west of Eastern. */
function asStoredDate(instant: Date): Date {
  return new Date(`${appDateKey(instant)}T00:00:00Z`);
}

/** The old model had a weekly pattern; bookings are dated, so a test that
 * wants "every Monday evening" has to spell out the Mondays. Four weeks
 * matches the search window. */
function weeklyBookings(
  weekday: number,
  startTime: string,
  endTime: string,
): { date: Date; startTime: string; endTime: string }[] {
  const out: { date: Date; startTime: string; endTime: string }[] = [];
  const cursor = new Date(nextMonday);
  for (let i = 0; i < 40; i++) {
    const day = new Date(cursor.getTime() + i * 24 * 60 * 60 * 1000);
    if (zonedParts(day).weekday === weekday) {
      out.push({ date: asStoredDate(day), startTime, endTime });
    }
  }
  return out;
}

const base: SchedulingInput = {
  castMembers: [
    { userId: "choreo1", name: "Choreo One", role: "CHOREOGRAPHER" },
    { userId: "dancer1", name: "Dancer One", role: "DANCER" },
    { userId: "dancer2", name: "Dancer Two", role: "DANCER" },
  ],
  conflicts: [],
  unavailabilities: [],
  existingPracticesForCast: [],
  spaces: [
    {
      spaceId: "space1",
      spaceName: "Studio A",
      bookings: weeklyBookings(dayOfWeek, "18:00", "21:00"),
      existingPractices: [],
    },
  ],
  choreographerExcusedByWeek: new Map(),
  ignoredUserIds: new Set(),
  danceId: "dance1",
  durationMinutes: 90,
  searchWeeks: 4,
  slotIncrementMinutes: 30,
};

/** Builds a variant of `base` with a different set of bookable windows
 * and/or practices already booked into the room. */
function withSpace(opts: {
  windows?: { dayOfWeek: number; startTime: string; endTime: string }[];
  booked?: SchedulingInput["spaces"][number]["existingPractices"];
}): SchedulingInput {
  return {
    ...base,
    spaces: [
      {
        ...base.spaces[0],
        bookings: opts.windows
          ? opts.windows.flatMap((w) =>
              weeklyBookings(w.dayOfWeek, w.startTime, w.endTime),
            )
          : base.spaces[0].bookings,
        existingPractices: opts.booked ?? [],
      },
    ],
  };
}

// Test 1: baseline — should produce candidates, best score 0.
{
  const result = generateCandidateSlots(base);
  assert(result.length > 0, "baseline produces candidates");
  assert(result[0].score === 0, "baseline best candidate has score 0 (no conflicts)");
}

// Test 2: choreographer conflict should hard-fail every slot that overlaps it.
{
  const conflictStart = minutesIntoAppDay(nextMonday, 1080);
  const conflictEnd = minutesIntoAppDay(nextMonday, 1260);
  const input = {
    ...base,
    conflicts: [
      {
        id: "c1",
        userId: "choreo1",
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        isExcused: false,
      },
    ],
  };
  const result = generateCandidateSlots(input);
  const hasThatDay = result.some(
    (c) => appDateKey(c.startDateTime) === appDateKey(nextMonday),
  );
  assert(
    !hasThatDay,
    "choreographer conflict hard-fails candidates on that day (mandatory attendee)",
  );
}

// Test 3: choreographer weekly excuse lifts the hard-fail for that week only.
{
  const conflictStart = minutesIntoAppDay(nextMonday, 1080);
  const conflictEnd = minutesIntoAppDay(nextMonday, 1260);
  const weekKey = startOfWeek(nextMonday).toISOString();
  const excusedByWeek = new Map([[weekKey, new Set(["choreo1"])]]);
  const input = {
    ...base,
    conflicts: [
      {
        id: "c1",
        userId: "choreo1",
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        isExcused: false,
      },
    ],
    choreographerExcusedByWeek: excusedByWeek,
  };
  const result = generateCandidateSlots(input);
  const hasThatDay = result.some(
    (c) => appDateKey(c.startDateTime) === appDateKey(nextMonday),
  );
  assert(hasThatDay, "weekly excuse lifts the hard-fail for that specific week");
}

// Test 4: unexcused dancer conflict soft-scores 2, excused scores 1.
// Uses a duration-exact window (one slot/week) so the conflicted candidate
// can't be pushed out of the top-8 cap by unrelated zero-score slots.
{
  const conflictStart = minutesIntoAppDay(nextMonday, 1080);
  const conflictEnd = minutesIntoAppDay(nextMonday, 1170);
  const input = {
    ...withSpace({ windows: [{ dayOfWeek, startTime: "18:00", endTime: "19:30" }] }),
    conflicts: [
      {
        id: "c1",
        userId: "dancer1",
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        isExcused: false,
      },
    ],
  };
  const result = generateCandidateSlots(input);
  const slot = result.find(
    (c) => c.startDateTime.getTime() === conflictStart.getTime(),
  );
  assert(!!slot && slot.score === 2, "unexcused dancer conflict scores 2 points");
}

// Test 5: ignoring a conflicted dancer removes their penalty from the score.
{
  const conflictStart = minutesIntoAppDay(nextMonday, 1080);
  const conflictEnd = minutesIntoAppDay(nextMonday, 1170);
  const input = {
    ...base,
    conflicts: [
      {
        id: "c1",
        userId: "dancer1",
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        isExcused: false,
      },
    ],
    ignoredUserIds: new Set(["dancer1"]),
  };
  const result = generateCandidateSlots(input);
  const slot = result.find(
    (c) => c.startDateTime.getTime() === conflictStart.getTime(),
  );
  assert(!!slot && slot.score === 0, "ignoring the conflicted dancer zeroes their penalty");
}

// Test 6: double-booking the same space hard-fails that slot.
{
  const bookedStart = minutesIntoAppDay(nextMonday, 1080);
  const bookedEnd = minutesIntoAppDay(nextMonday, 1170);
  const input = withSpace({
    booked: [
      {
        id: "p1",
        danceId: "otherDance",
        startDateTime: bookedStart,
        endDateTime: bookedEnd,
        castUserIds: [],
      },
    ],
  });
  const result = generateCandidateSlots(input);
  const clashes = result.some(
    (c) => c.startDateTime.getTime() === bookedStart.getTime(),
  );
  assert(!clashes, "existing practice at the same space hard-fails an overlapping slot");
}

// Test 7: a shared dancer's CONFIRMED practice in another dance scores as a clash.
{
  const otherStart = minutesIntoAppDay(nextMonday, 1080);
  const otherEnd = minutesIntoAppDay(nextMonday, 1170);
  const input = {
    ...withSpace({ windows: [{ dayOfWeek, startTime: "18:00", endTime: "19:30" }] }),
    existingPracticesForCast: [
      {
        id: "p1",
        danceId: "otherDance",
        startDateTime: otherStart,
        endDateTime: otherEnd,
        castUserIds: ["dancer1"],
      },
    ],
  };
  const result = generateCandidateSlots(input);
  const slot = result.find(
    (c) => c.startDateTime.getTime() === otherStart.getTime(),
  );
  assert(
    !!slot && slot.score === 2,
    "a shared cast member's confirmed practice elsewhere scores as a clash (2 points)",
  );
}

// Test 8: suggestions spread across days instead of slicing one wide-open
// window into eight near-identical options.
{
  const input = withSpace({
    // A very wide window on two different days.
    windows: [
      { dayOfWeek, startTime: "12:00", endTime: "20:00" },
      { dayOfWeek: (dayOfWeek + 2) % 7, startTime: "12:00", endTime: "20:00" },
    ],
  });
  const result = generateCandidateSlots(input);
  const distinctDays = new Set(
    result.map((c) => appDateKey(c.startDateTime)),
  );
  assert(
    distinctDays.size >= 4,
    `suggestions span multiple days rather than one afternoon (got ${distinctDays.size} distinct days across ${result.length} slots)`,
  );

  const perDay = new Map<string, number>();
  for (const c of result) {
    const k = appDateKey(c.startDateTime);
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  assert(
    Math.max(...perDay.values()) <= 2,
    "no single day dominates the suggestion list",
  );
}

// Test 9: when the space is only open one day a week, still return a full
// list rather than starving it via the per-day cap.
{
  const input: SchedulingInput = {
    ...withSpace({ windows: [{ dayOfWeek, startTime: "12:00", endTime: "20:00" }] }),
    searchWeeks: 2,
  };
  const result = generateCandidateSlots(input);
  assert(
    result.length > 2,
    `single-open-day space still yields several options (got ${result.length})`,
  );
}

// Test 10: searching "any space" considers every room, and each candidate
// reports which room it belongs to.
{
  const otherDay = (dayOfWeek + 3) % 7;
  const input: SchedulingInput = {
    ...base,
    spaces: [
      {
        spaceId: "space1",
        spaceName: "Studio A",
        bookings: weeklyBookings(dayOfWeek, "18:00", "19:30"),
        existingPractices: [],
      },
      {
        spaceId: "space2",
        spaceName: "Black Box",
        bookings: weeklyBookings(otherDay, "13:00", "14:30"),
        existingPractices: [],
      },
    ],
  };
  const result = generateCandidateSlots(input);
  const rooms = new Set(result.map((c) => c.spaceName));
  assert(rooms.has("Studio A") && rooms.has("Black Box"), "any-space search returns slots from every room");
  assert(
    result.every((c) => !!c.spaceId && !!c.spaceName),
    "every candidate names the room it would book",
  );
}

// Test 11: a room already booked is skipped, but the same time in a
// different free room is still offered.
{
  const clashStart = minutesIntoAppDay(nextMonday, 1080);
  const clashEnd = minutesIntoAppDay(nextMonday, 1170);

  const input: SchedulingInput = {
    ...base,
    spaces: [
      {
        spaceId: "space1",
        spaceName: "Studio A",
        bookings: weeklyBookings(dayOfWeek, "18:00", "19:30"),
        existingPractices: [
          {
            id: "p1",
            danceId: "otherDance",
            startDateTime: clashStart,
            endDateTime: clashEnd,
            castUserIds: [],
          },
        ],
      },
      {
        spaceId: "space2",
        spaceName: "Black Box",
        bookings: weeklyBookings(dayOfWeek, "18:00", "19:30"),
        existingPractices: [],
      },
    ],
  };
  const result = generateCandidateSlots(input);
  const atClashTime = result.find(
    (c) => c.startDateTime.getTime() === clashStart.getTime(),
  );
  assert(
    !!atClashTime && atClashTime.spaceName === "Black Box",
    "a booked room falls through to the free room at the same time",
  );
}

// Test 12: historical weighting nudges the ranking but never outranks a
// real logged conflict, and is fully off when no rates are supplied.
{
  const slotStart = minutesIntoAppDay(nextMonday, 1080);

  const oneSlotPerWeek = withSpace({
    windows: [{ dayOfWeek, startTime: "18:00", endTime: "19:30" }],
  });

  const withoutHistory = generateCandidateSlots(oneSlotPerWeek);
  const baselineScore = withoutHistory.find(
    (c) => c.startDateTime.getTime() === slotStart.getTime(),
  )?.score;
  assert(baselineScore === 0, "no historical data means no historical penalty");

  const withHistory = generateCandidateSlots({
    ...oneSlotPerWeek,
    historicalAbsenceRates: new Map([
      ["dancer1", new Map([[dayOfWeek, 1]])],
    ]),
  });
  const nudged = withHistory.find(
    (c) => c.startDateTime.getTime() === slotStart.getTime(),
  );
  assert(
    !!nudged && nudged.score > 0,
    `a habitual no-show on this weekday raises the score (got ${nudged?.score})`,
  );
  assert(
    !!nudged && nudged.score < 2,
    "the historical nudge stays below the cost of one real logged conflict",
  );

  // A mild historical rate shouldn't register at all.
  const mild = generateCandidateSlots({
    ...oneSlotPerWeek,
    historicalAbsenceRates: new Map([
      ["dancer1", new Map([[dayOfWeek, 0.25]])],
    ]),
  });
  const mildSlot = mild.find(
    (c) => c.startDateTime.getTime() === slotStart.getTime(),
  );
  assert(
    !!mildSlot && mildSlot.score === 0,
    "an occasional miss doesn't brand the whole weekday",
  );
}

// Bookings are dated, so "the room isn't ours that day" is simply the absence
// of a booking — there is no closure record to apply on top of a pattern.
{
  const withoutMonday = generateCandidateSlots({
    ...base,
    spaces: [
      {
        ...base.spaces[0],
        bookings: base.spaces[0].bookings.filter(
          (b) => b.date.toISOString().slice(0, 10) !== appDateKey(nextMonday),
        ),
      },
    ],
  });
  assert(
    withoutMonday.every(
      (c) => appDateKey(c.startDateTime) !== appDateKey(nextMonday),
    ),
    "no booking on a date means no slots on that date",
  );
  assert(withoutMonday.length > 0, "other dates are unaffected");

  const middayOnly = generateCandidateSlots({
    ...base,
    spaces: [
      {
        ...base.spaces[0],
        bookings: [
          { date: asStoredDate(nextMonday), startTime: "12:00", endTime: "15:00" },
        ],
      },
    ],
  });
  assert(
    middayOnly.length > 0 &&
      middayOnly.every(
        (c) =>
          zonedParts(c.startDateTime).hour >= 12 &&
          zonedParts(c.startDateTime).hour < 15,
      ),
    "slots come only from the hours actually booked",
  );
}

if (process.exitCode) {
  console.error("\nSome scheduling algorithm tests FAILED");
} else {
  console.log("\nAll scheduling algorithm tests passed");
}
