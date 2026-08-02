import { generateCandidateSlots, type SchedulingInput } from "./scheduling";
import { startOfWeek, addDays } from "./dates";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("PASS:", msg);
  }
}

const nextMonday = addDays(startOfWeek(new Date()), 7);
const dayOfWeek = nextMonday.getDay();

const base: SchedulingInput = {
  castMembers: [
    { userId: "choreo1", name: "Choreo One", role: "CHOREOGRAPHER" },
    { userId: "dancer1", name: "Dancer One", role: "DANCER" },
    { userId: "dancer2", name: "Dancer Two", role: "DANCER" },
  ],
  conflicts: [],
  unavailabilities: [],
  existingPracticesAtSpace: [],
  existingPracticesForCast: [],
  recurringWindows: [{ dayOfWeek, startTime: "18:00", endTime: "21:00" }],
  dateOverrides: [],
  choreographerExcusedByWeek: new Map(),
  ignoredUserIds: new Set(),
  danceId: "dance1",
  durationMinutes: 90,
  searchWeeks: 4,
  slotIncrementMinutes: 30,
};

// Test 1: baseline — should produce candidates, best score 0.
{
  const result = generateCandidateSlots(base);
  assert(result.length > 0, "baseline produces candidates");
  assert(result[0].score === 0, "baseline best candidate has score 0 (no conflicts)");
}

// Test 2: choreographer conflict should hard-fail every slot that overlaps it.
{
  const conflictStart = new Date(nextMonday);
  conflictStart.setHours(18, 0, 0, 0);
  const conflictEnd = new Date(nextMonday);
  conflictEnd.setHours(21, 0, 0, 0);
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
    (c) => c.startDateTime.toDateString() === nextMonday.toDateString(),
  );
  assert(
    !hasThatDay,
    "choreographer conflict hard-fails candidates on that day (mandatory attendee)",
  );
}

// Test 3: choreographer weekly excuse lifts the hard-fail for that week only.
{
  const conflictStart = new Date(nextMonday);
  conflictStart.setHours(18, 0, 0, 0);
  const conflictEnd = new Date(nextMonday);
  conflictEnd.setHours(21, 0, 0, 0);
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
    (c) => c.startDateTime.toDateString() === nextMonday.toDateString(),
  );
  assert(hasThatDay, "weekly excuse lifts the hard-fail for that specific week");
}

// Test 4: unexcused dancer conflict soft-scores 2, excused scores 1.
// Uses a duration-exact window (one slot/week) so the conflicted candidate
// can't be pushed out of the top-8 cap by unrelated zero-score slots.
{
  const conflictStart = new Date(nextMonday);
  conflictStart.setHours(18, 0, 0, 0);
  const conflictEnd = new Date(nextMonday);
  conflictEnd.setHours(19, 30, 0, 0);
  const input = {
    ...base,
    recurringWindows: [{ dayOfWeek, startTime: "18:00", endTime: "19:30" }],
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
  const conflictStart = new Date(nextMonday);
  conflictStart.setHours(18, 0, 0, 0);
  const conflictEnd = new Date(nextMonday);
  conflictEnd.setHours(19, 30, 0, 0);
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
  const bookedStart = new Date(nextMonday);
  bookedStart.setHours(18, 0, 0, 0);
  const bookedEnd = new Date(nextMonday);
  bookedEnd.setHours(19, 30, 0, 0);
  const input = {
    ...base,
    existingPracticesAtSpace: [
      {
        id: "p1",
        danceId: "otherDance",
        startDateTime: bookedStart,
        endDateTime: bookedEnd,
        castUserIds: [],
      },
    ],
  };
  const result = generateCandidateSlots(input);
  const clashes = result.some(
    (c) => c.startDateTime.getTime() === bookedStart.getTime(),
  );
  assert(!clashes, "existing practice at the same space hard-fails an overlapping slot");
}

// Test 7: a shared dancer's CONFIRMED practice in another dance scores as a clash.
{
  const otherStart = new Date(nextMonday);
  otherStart.setHours(18, 0, 0, 0);
  const otherEnd = new Date(nextMonday);
  otherEnd.setHours(19, 30, 0, 0);
  const input = {
    ...base,
    recurringWindows: [{ dayOfWeek, startTime: "18:00", endTime: "19:30" }],
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

if (process.exitCode) {
  console.error("\nSome scheduling algorithm tests FAILED");
} else {
  console.log("\nAll scheduling algorithm tests passed");
}
