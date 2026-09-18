/** Timezone tests.
 *
 * These run with TZ deliberately set to something that is not Eastern (see
 * npm test), because the bug being guarded against is exactly "works on my
 * laptop, wrong on the server". Every assertion here failed before
 * src/lib/timezone.ts existed. */
import {
  calendarDateFormatter,
  calendarDateFromInput,
  defaultConflictWeek,
} from "./dates";
import {
  addDaysInApp,
  appDateKey,
  appTimeKey,
  clampToSupportedRange,
  endOfDayInApp,
  isSameAppDay,
  parseAppDateTime,
  startOfDayInApp,
  startOfWeekInApp,
  zonedParts,
  zonedTimeToInstant,
  EARLIEST_SUPPORTED_DATE,
} from "./timezone";

let failures = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`PASS: ${label}`);
  } else {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  assert(
    actual === expected,
    `${label}${actual === expected ? "" : ` (got ${String(actual)}, wanted ${String(expected)})`}`,
  );
}

// --- reading an instant in Eastern terms -----------------------------------

// 2026-03-10T00:30:00Z is 8:30pm on 9 March, Eastern — EDT by then, since
// the transition is the second Sunday of March (the 8th).
assertEqual(
  appDateKey(new Date("2026-03-10T00:30:00Z")),
  "2026-03-09",
  "an evening practice belongs to that evening, not the next UTC day",
);
assertEqual(
  appTimeKey(new Date("2026-03-10T00:30:00Z")),
  "20:30",
  "8:30pm reads as 20:30, not 00:30",
);

// Deep winter: EST, UTC-5.
assertEqual(
  appDateKey(new Date("2026-01-15T02:00:00Z")),
  "2026-01-14",
  "9pm in January belongs to the 14th",
);
assertEqual(appTimeKey(new Date("2026-01-15T02:00:00Z")), "21:00", "9pm EST");

// --- daylight saving --------------------------------------------------------

// EST -> EDT at 2am on 8 March 2026. 7pm before and after must both read 19:00.
assertEqual(
  appTimeKey(zonedTimeToInstant(2026, 3, 7, 19, 0)),
  "19:00",
  "7pm the day before the spring transition",
);
assertEqual(
  appTimeKey(zonedTimeToInstant(2026, 3, 9, 19, 0)),
  "19:00",
  "7pm the day after the spring transition",
);
assertEqual(
  zonedTimeToInstant(2026, 3, 7, 19, 0).toISOString(),
  "2026-03-08T00:00:00.000Z",
  "7pm EST is midnight UTC",
);
assertEqual(
  zonedTimeToInstant(2026, 3, 9, 19, 0).toISOString(),
  "2026-03-09T23:00:00.000Z",
  "7pm EDT is 11pm UTC — an hour earlier in UTC than the same wall time in EST",
);

// EDT -> EST at 2am on 1 November 2026.
assertEqual(
  appTimeKey(zonedTimeToInstant(2026, 11, 2, 19, 0)),
  "19:00",
  "7pm the day after the autumn transition",
);

// Crossing a transition by adding days must preserve wall-clock time.
assertEqual(
  appTimeKey(addDaysInApp(zonedTimeToInstant(2026, 3, 7, 19, 0), 2)),
  "19:00",
  "adding two days across the spring transition keeps 7pm at 7pm",
);
assertEqual(
  appDateKey(addDaysInApp(zonedTimeToInstant(2026, 3, 7, 19, 0), 2)),
  "2026-03-09",
  "…and lands on the right date",
);

// --- week boundaries --------------------------------------------------------

// 2026-08-03 is a Monday. Sunday 2nd at 11pm Eastern is still the *previous*
// week; the pre-fix code put it in the new one because it read as Monday UTC.
assertEqual(
  appDateKey(startOfWeekInApp(new Date("2026-08-03T03:00:00Z"))),
  "2026-07-27",
  "Sunday 11pm Eastern belongs to the week beginning the previous Monday",
);
assertEqual(
  appDateKey(startOfWeekInApp(zonedTimeToInstant(2026, 8, 3, 0, 1))),
  "2026-08-03",
  "one minute past midnight Monday starts the new week",
);
assertEqual(
  appDateKey(startOfWeekInApp(zonedTimeToInstant(2026, 8, 9, 23, 59))),
  "2026-08-03",
  "Sunday night is the end of the same week",
);
assertEqual(
  startOfWeekInApp(zonedTimeToInstant(2026, 8, 5, 12, 0)).toISOString(),
  "2026-08-03T04:00:00.000Z",
  "a week starts at Eastern midnight, which is 4am UTC in summer",
);

// A week that contains the spring transition is still seven calendar days.
assertEqual(
  appDateKey(addDaysInApp(zonedTimeToInstant(2026, 3, 2, 0, 0), 7)),
  "2026-03-09",
  "a week spanning the DST change advances exactly seven days",
);

// --- day boundaries ---------------------------------------------------------

assertEqual(
  startOfDayInApp(new Date("2026-06-15T18:00:00Z")).toISOString(),
  "2026-06-15T04:00:00.000Z",
  "start of an Eastern day in summer is 4am UTC",
);
assertEqual(
  appTimeKey(endOfDayInApp(new Date("2026-06-15T18:00:00Z"))),
  "23:59",
  "end of day is 23:59 Eastern",
);
assert(
  isSameAppDay(
    new Date("2026-06-15T18:00:00Z"),
    new Date("2026-06-16T03:00:00Z"),
  ),
  "11pm and 2pm the same Eastern day are the same day",
);
assert(
  !isSameAppDay(
    new Date("2026-06-16T03:59:00Z"),
    new Date("2026-06-16T04:01:00Z"),
  ),
  "either side of Eastern midnight are different days",
);

// --- parsing what someone typed --------------------------------------------

assertEqual(
  parseAppDateTime("2026-09-14", "19:30").toISOString(),
  "2026-09-14T23:30:00.000Z",
  "a 7:30pm practice typed in September is stored as 23:30 UTC",
);
assertEqual(
  appDateKey(parseAppDateTime("2026-12-01")),
  "2026-12-01",
  "a date with no time round-trips to the same day",
);
assertEqual(
  appTimeKey(parseAppDateTime("2026-12-01")),
  "00:00",
  "…at midnight Eastern",
);

// --- retroactive range floor ------------------------------------------------

assertEqual(
  clampToSupportedRange(new Date("2025-08-01T00:00:00Z")).toISOString(),
  EARLIEST_SUPPORTED_DATE.toISOString(),
  "a range starting before 2026 is pulled forward to the floor",
);
assertEqual(
  clampToSupportedRange(new Date("2026-05-05T00:00:00Z")).toISOString(),
  "2026-05-05T00:00:00.000Z",
  "a range inside the supported window is left alone",
);

// --- parts ------------------------------------------------------------------

const midnight = zonedParts(zonedTimeToInstant(2026, 7, 4, 0, 0));
assertEqual(midnight.hour, 0, "midnight reads as hour 0, not hour 24");
assertEqual(midnight.day, 4, "…on the right day");
assertEqual(midnight.weekday, 6, "4 July 2026 is a Saturday");

// --- date-only columns display as the day they name -------------------------
// Reported twice on two screens: somebody marks themselves away on the 19th
// and 20th, and the app shows the 18th and 19th. A `@db.Date` is a bare
// calendar day handed back at UTC midnight, so the Eastern formatter lands at
// 8pm the evening before. `calendarDateFormatter` pins the zone so it can't.
{
  const stored = calendarDateFromInput("2026-09-19");
  const shown = calendarDateFormatter({ month: "short", day: "numeric" }).format(
    stored,
  );
  assertEqual(shown, "Sep 19", "an away date displays as the day it names");

  // The whole range, since the bug shifted both ends.
  const end = calendarDateFromInput("2026-09-20");
  assertEqual(
    calendarDateFormatter({ day: "numeric" }).format(end),
    "20",
    "…and so does the last day of the window",
  );

  // New Year's Day is the sharp case: get the zone wrong and the year moves.
  assertEqual(
    calendarDateFormatter({ year: "numeric", month: "short", day: "numeric" })
      .format(calendarDateFromInput("2027-01-01")),
    "Jan 1, 2027",
    "…and a January date doesn't slip into the previous year",
  );

  // The zone is not the caller's to set — that is the whole point of the
  // helper, and passing one through would quietly reintroduce the bug.
  const forced = calendarDateFormatter({
    day: "numeric",
    // @ts-expect-error timeZone is deliberately excluded from the options type
    timeZone: "America/New_York",
  });
  assertEqual(
    forced.format(stored),
    "19",
    "…and an attempt to override the zone is ignored",
  );
}

// --- which week the conflicts screens open on ---------------------------------
// The schedule is built a week ahead, so these screens open on next week
// rather than the one already scheduled. It rolls over at 6am Monday, not
// midnight, so somebody opening the app late on Sunday night still sees the
// week they were being chased about.
{
  // Eastern is UTC-4 in September, so 06:00 Eastern is 10:00 UTC.
  const openOn = (iso: string) => appDateKey(defaultConflictWeek(new Date(iso)));

  assertEqual(
    openOn("2026-09-14T09:59:00Z"),
    "2026-09-14",
    "just before 6am Monday it still opens on the week that was being chased",
  );
  assertEqual(
    openOn("2026-09-14T10:00:00Z"),
    "2026-09-21",
    "at 6am Monday it rolls onto the following week",
  );
  assertEqual(
    openOn("2026-09-17T16:00:00Z"),
    "2026-09-21",
    "on the Thursday the reminders go out, it is the week they are about",
  );
  assertEqual(
    openOn("2026-09-20T23:30:00Z"),
    "2026-09-21",
    "late on Sunday night it is still the same week, not two ahead",
  );
  assertEqual(
    openOn("2026-09-21T10:00:00Z"),
    "2026-09-28",
    "the next Monday at 6am it moves on again",
  );

  // Eastern is UTC-5 in January, so 06:00 Eastern is 11:00 UTC. A fixed
  // offset would put this an hour out and flip the answer.
  assertEqual(
    openOn("2027-01-11T10:59:00Z"),
    "2027-01-11",
    "the 6am rollover follows the clocks: still before it in winter",
  );
  assertEqual(
    openOn("2027-01-11T11:00:00Z"),
    "2027-01-18",
    "…and lands on it an hour later than it would in summer",
  );
}

if (failures > 0) {
  console.error(`\n${failures} timezone test(s) failed`);
  process.exit(1);
}
console.log("\nAll timezone tests passed");
