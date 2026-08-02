import {
  classifyAttendance,
  isChronicallyAbsent,
  summarizePerson,
  summarizePractice,
  type AbsenceKind,
} from "./attendance";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else {
    console.log("PASS:", msg);
  }
}

const practiceStart = new Date("2026-08-05T18:00:00");
const practiceEnd = new Date("2026-08-05T19:30:00");

// --- classifyAttendance ---

assert(
  classifyAttendance("u1", true, practiceStart, practiceEnd, [], []) === "present",
  "attended = present",
);

assert(
  classifyAttendance("u1", false, practiceStart, practiceEnd, [], []) === "no-show",
  "absent with nothing logged = no-show",
);

assert(
  classifyAttendance(
    "u1",
    false,
    practiceStart,
    practiceEnd,
    [
      {
        userId: "u1",
        startDateTime: new Date("2026-08-05T18:30:00"),
        endDateTime: new Date("2026-08-05T20:00:00"),
        isExcused: true,
      },
    ],
    [],
  ) === "excused-conflict",
  "absent with an overlapping excused conflict = excused",
);

assert(
  classifyAttendance(
    "u1",
    false,
    practiceStart,
    practiceEnd,
    [
      {
        userId: "u1",
        startDateTime: new Date("2026-08-05T18:30:00"),
        endDateTime: new Date("2026-08-05T20:00:00"),
        isExcused: false,
      },
    ],
    [],
  ) === "unexcused-conflict",
  "absent with an overlapping unexcused conflict = unexcused",
);

assert(
  classifyAttendance(
    "u1",
    false,
    practiceStart,
    practiceEnd,
    [],
    [
      {
        userId: "u1",
        startDate: new Date("2026-08-03"),
        endDate: new Date("2026-08-07"),
      },
    ],
  ) === "excused-unavailable",
  "absent during an out-of-town window = excused (window is inclusive of end day)",
);

assert(
  classifyAttendance(
    "u1",
    false,
    practiceStart,
    practiceEnd,
    [
      {
        userId: "u1",
        // Conflict is on a different day entirely.
        startDateTime: new Date("2026-08-06T18:00:00"),
        endDateTime: new Date("2026-08-06T20:00:00"),
        isExcused: true,
      },
    ],
    [],
  ) === "no-show",
  "a non-overlapping conflict does not excuse the absence",
);

assert(
  classifyAttendance(
    "u1",
    false,
    practiceStart,
    practiceEnd,
    [
      {
        userId: "otherUser",
        startDateTime: practiceStart,
        endDateTime: practiceEnd,
        isExcused: true,
      },
    ],
    [],
  ) === "no-show",
  "another person's conflict does not excuse this person",
);

// --- summarizePractice ---

{
  const summary = summarizePractice([
    { kind: "present" },
    { kind: "present" },
    { kind: "excused-conflict" },
    { kind: "no-show" },
  ]);
  assert(summary.presentCount === 2, "practice summary counts present");
  assert(summary.absentCount === 2, "practice summary counts absent");
  assert(summary.unexcusedCount === 1, "practice summary counts unexcused only");
  assert(summary.absentPercent === 50, "practice summary computes % missing");
}

{
  const summary = summarizePractice([{ kind: null }, { kind: null }]);
  assert(
    summary.markedCount === 0 && summary.absentPercent === 0,
    "unmarked practice doesn't divide by zero",
  );
}

// --- summarizePerson ---

{
  const summary = summarizePerson("u1", [
    "present",
    "present",
    "present",
    "excused-unavailable",
    "no-show",
  ]);
  assert(summary.presentCount === 3, "person summary counts present");
  assert(summary.excusedAbsences === 1, "person summary counts excused absences");
  assert(summary.unexcusedAbsences === 1, "person summary counts unexcused absences");
  assert(summary.attendanceRate === 60, "person summary computes attendance rate");
}

// --- isChronicallyAbsent (threshold 3 of last 5) ---

{
  const flagged: AbsenceKind[] = ["no-show", "no-show", "unexcused-conflict", "present", "present"];
  assert(
    isChronicallyAbsent(flagged, 3, 5),
    "3 unexcused in the last 5 trips the chronic-absence flag",
  );
}

{
  const notFlagged: AbsenceKind[] = ["no-show", "no-show", "present", "present", "present"];
  assert(
    !isChronicallyAbsent(notFlagged, 3, 5),
    "2 unexcused in the last 5 does not trip the flag",
  );
}

{
  const excusedHeavy: AbsenceKind[] = [
    "excused-conflict",
    "excused-unavailable",
    "excused-conflict",
    "present",
    "present",
  ];
  assert(
    !isChronicallyAbsent(excusedHeavy, 3, 5),
    "excused absences never trip the chronic-absence flag",
  );
}

{
  // Older unexcused absences fall outside the window and stop counting.
  const aged: AbsenceKind[] = [
    "present",
    "present",
    "present",
    "present",
    "present",
    "no-show",
    "no-show",
    "no-show",
  ];
  assert(
    !isChronicallyAbsent(aged, 3, 5),
    "unexcused absences older than the window stop counting",
  );
}

if (failures > 0) {
  console.error(`\n${failures} attendance test(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nAll attendance tests passed");
}
