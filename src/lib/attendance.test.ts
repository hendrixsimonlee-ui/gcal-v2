import {
  computeMinutesLate,
  effectivePracticeStart,
  isChronicallyAbsent,
  isExpectedToCheckIn,
  statusForNoCheckIn,
  statusFromCheckIn,
  summarizePerson,
  summarizePractice,
  type AttendanceStatus,
  type ConflictWindow,
  type UnavailabilityWindow,
} from "./attendance";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("PASS:", msg);
  }
}

const start = new Date("2026-09-10T18:00:00");
const end = new Date("2026-09-10T20:00:00");
const at = (h: number, m: number) =>
  new Date(`2026-09-10T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);

const LATE_THRESHOLD = 5;

// --- lateness ---
{
  assert(
    computeMinutesLate(at(18, 0), start, null) === 0,
    "arriving exactly on time is zero minutes late",
  );
  assert(
    computeMinutesLate(at(17, 50), start, null) === 0,
    "arriving early is never negative",
  );
  assert(
    computeMinutesLate(at(18, 12), start, null) === 12,
    "twelve minutes past the start is twelve minutes late",
  );
  assert(
    statusFromCheckIn(4, LATE_THRESHOLD) === "PRESENT",
    "under the threshold counts as on time",
  );
  assert(
    statusFromCheckIn(5, LATE_THRESHOLD) === "LATE",
    "at the threshold counts as late",
  );
}

// --- the choreographer records a late start ---
{
  const realStart = effectivePracticeStart(start, at(18, 20));
  assert(
    computeMinutesLate(at(18, 15), realStart, null) === 0,
    "nobody is late for a practice that hadn't started yet",
  );
  assert(
    computeMinutesLate(at(18, 30), realStart, null) === 10,
    "lateness is measured from the real start once it's recorded",
  );
  assert(
    effectivePracticeStart(start, null).getTime() === start.getTime(),
    "with no recorded start, the scheduled time stands",
  );
}

// --- agreed late arrivals ---
{
  const agreed = at(18, 30);
  assert(
    computeMinutesLate(at(18, 30), start, agreed) === 0,
    "turning up when you agreed to is on time, not 30 minutes late",
  );
  assert(
    computeMinutesLate(at(18, 25), start, agreed) === 0,
    "beating your agreed time is still on time",
  );
  assert(
    computeMinutesLate(at(18, 45), start, agreed) === 15,
    "past your agreed time, lateness counts from there",
  );
}

// --- who has to check in ---
{
  const conflicts: ConflictWindow[] = [
    {
      userId: "excused-person",
      startDateTime: at(17, 0),
      endDateTime: at(21, 0),
      status: "EXCUSED",
    },
    {
      userId: "unexcused-person",
      startDateTime: at(17, 0),
      endDateTime: at(21, 0),
      status: "UNEXCUSED",
    },
    {
      userId: "elsewhere-person",
      startDateTime: new Date("2026-09-11T18:00:00"),
      endDateTime: new Date("2026-09-11T20:00:00"),
      status: "EXCUSED",
    },
  ];
  const unavailable: UnavailabilityWindow[] = [
    {
      userId: "away-person",
      startDate: new Date("2026-09-08T00:00:00"),
      endDate: new Date("2026-09-12T00:00:00"),
    },
  ];

  assert(
    isExpectedToCheckIn("nobody-special", start, end, conflicts, unavailable),
    "someone with nothing logged is expected to check in",
  );
  assert(
    !isExpectedToCheckIn("excused-person", start, end, conflicts, unavailable),
    "an excused conflict means nobody chases them to check in",
  );
  assert(
    !isExpectedToCheckIn("unexcused-person", start, end, conflicts, unavailable),
    "a known unexcused absence doesn't need a check-in either",
  );
  assert(
    !isExpectedToCheckIn("away-person", start, end, conflicts, unavailable),
    "out of town means no check-in",
  );
  assert(
    isExpectedToCheckIn("elsewhere-person", start, end, conflicts, unavailable),
    "a conflict on another day doesn't excuse this practice",
  );

  // ...and what gets recorded for each of them.
  assert(
    statusForNoCheckIn("nobody-special", start, end, conflicts, unavailable) ===
      "UNEXCUSED_ABSENT",
    "no check-in and nothing logged is unexcused",
  );
  assert(
    statusForNoCheckIn("excused-person", start, end, conflicts, unavailable) ===
      "EXCUSED_ABSENT",
    "an excused conflict makes the absence excused",
  );
  assert(
    statusForNoCheckIn("unexcused-person", start, end, conflicts, unavailable) ===
      "UNEXCUSED_ABSENT",
    "an unexcused conflict stays unexcused",
  );
  assert(
    statusForNoCheckIn("away-person", start, end, conflicts, unavailable) ===
      "EXCUSED_ABSENT",
    "out of town is an excused absence",
  );

  const unreviewed: ConflictWindow[] = [
    {
      userId: "pending-person",
      startDateTime: at(17, 0),
      endDateTime: at(21, 0),
      status: "NOT_REVIEWED",
    },
  ];
  assert(
    statusForNoCheckIn("pending-person", start, end, unreviewed, []) ===
      "UNEXCUSED_ABSENT",
    "a conflict nobody reviewed is not an excuse on its own",
  );
}

// --- rollups ---
{
  const summary = summarizePractice([
    { status: "PRESENT" },
    { status: "LATE", minutesLate: 12 },
    { status: "LATE", minutesLate: 6 },
    { status: "EXCUSED_ABSENT" },
    { status: "UNEXCUSED_ABSENT" },
    { status: null },
  ]);
  assert(summary.totalCast === 6, "the whole cast is counted");
  assert(summary.markedCount === 5, "unrecorded people don't count as marked");
  assert(summary.presentCount === 3, "late people still turned up");
  assert(summary.lateCount === 2, "late is counted separately");
  assert(summary.absentCount === 2, "both kinds of absence count as absent");
  assert(summary.unexcusedCount === 1, "only unexcused absences are unexcused");
  assert(summary.totalMinutesLate === 18, "minutes late add up");
  assert(summary.absentPercent === 40, "2 of 5 marked is 40% missing");

  const empty = summarizePractice([{ status: null }, { status: null }]);
  assert(empty.absentPercent === 0, "an unmarked practice doesn't divide by zero");
}

{
  const person = summarizePerson("u1", [
    { status: "PRESENT" },
    { status: "LATE", minutesLate: 9 },
    { status: "EXCUSED_ABSENT" },
    { status: "UNEXCUSED_ABSENT" },
  ]);
  assert(person.presentCount === 2, "person: late still counts as attending");
  assert(person.lateCount === 1, "person: late is tracked on its own");
  assert(person.excusedAbsences === 1, "person: excused absences counted");
  assert(person.unexcusedAbsences === 1, "person: unexcused absences counted");
  assert(person.totalMinutesLate === 9, "person: minutes late add up");
  assert(person.attendanceRate === 50, "person: 2 of 4 is a 50% rate");
}

// --- chronic absence, which deliberately ignores lateness ---
{
  const newestFirst: AttendanceStatus[] = [
    "UNEXCUSED_ABSENT",
    "UNEXCUSED_ABSENT",
    "UNEXCUSED_ABSENT",
    "PRESENT",
    "PRESENT",
  ];
  assert(
    isChronicallyAbsent(newestFirst, 3, 5),
    "3 unexcused in the last 5 trips the flag",
  );
  assert(
    !isChronicallyAbsent(["UNEXCUSED_ABSENT", "UNEXCUSED_ABSENT", "PRESENT"], 3, 5),
    "2 unexcused in the window does not",
  );
  assert(
    !isChronicallyAbsent(
      ["EXCUSED_ABSENT", "EXCUSED_ABSENT", "EXCUSED_ABSENT"],
      3,
      5,
    ),
    "excused absences never trip the flag",
  );
  assert(
    !isChronicallyAbsent(["LATE", "LATE", "LATE", "LATE"], 3, 5),
    "being repeatedly late is not the same as being absent",
  );
  assert(
    !isChronicallyAbsent(
      ["PRESENT", "PRESENT", "PRESENT", "UNEXCUSED_ABSENT", "UNEXCUSED_ABSENT", "UNEXCUSED_ABSENT"],
      3,
      5,
    ),
    "unexcused absences older than the window stop counting",
  );
}

if (process.exitCode) {
  console.error("\nSome attendance tests FAILED");
} else {
  console.log("\nAll attendance tests passed");
}
