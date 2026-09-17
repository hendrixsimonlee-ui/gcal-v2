/** All-day Google events have to become conflicts covering the whole day.
 *
 * This is now the only way somebody says "I'm gone Friday to Sunday" — the
 * separate out-of-town feature was removed in favour of it — so if this is
 * wrong, people get scheduled over on days they told the app they were away. */

import { googleEventWindow } from "./google-events";
import { appDateKey } from "./timezone";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log(`PASS: ${msg}`);
  else {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

// One all-day event on the 19th. Google sends the 20th as the end, exclusive.
{
  const w = googleEventWindow({
    start: { date: "2026-09-19" },
    end: { date: "2026-09-20" },
  });
  assert(appDateKey(w.start) === "2026-09-19", "an all-day event starts on the day it names");
  assert(
    w.start.toISOString() === "2026-09-19T04:00:00.000Z",
    "...at Eastern midnight, not UTC midnight",
  );
  assert(
    w.end.getTime() - w.start.getTime() === 24 * 60 * 60 * 1000,
    "...and covers exactly that one day",
  );
  assert(
    appDateKey(new Date(w.end.getTime() - 1)) === "2026-09-19",
    "...ending at the close of it, not spilling into the next",
  );
}

// A trip: Friday the 25th through Sunday the 27th, so Google's end is the 28th.
{
  const w = googleEventWindow({
    start: { date: "2026-09-25" },
    end: { date: "2026-09-28" },
  });
  assert(
    w.end.getTime() - w.start.getTime() === 3 * 24 * 60 * 60 * 1000,
    "a three-day trip covers three days",
  );
  assert(
    appDateKey(new Date(w.end.getTime() - 1)) === "2026-09-27",
    "...through the end of the last one",
  );
}

// The clocks go back on 1 November 2026, so that span is 49 hours of real
// time. Adding 24 hours per day would leave somebody bookable for an hour on
// the morning they're still away.
{
  const w = googleEventWindow({
    start: { date: "2026-10-31" },
    end: { date: "2026-11-02" },
  });
  assert(
    w.end.getTime() - w.start.getTime() === 49 * 60 * 60 * 1000,
    "a span over the clocks change is 49 hours, not 48",
  );
}

// Timed events are untouched — they carry their own offset.
{
  const w = googleEventWindow({
    start: { dateTime: "2026-09-19T19:00:00-04:00" },
    end: { dateTime: "2026-09-19T21:00:00-04:00" },
  });
  assert(
    w.start.toISOString() === "2026-09-19T23:00:00.000Z",
    "a timed event still parses as the instant it names",
  );
  assert(
    w.end.getTime() - w.start.getTime() === 2 * 60 * 60 * 1000,
    "...for the length it says",
  );
}

// A malformed all-day entry with no end must not produce an inverted or
// zero-length window, which would silently match nothing.
{
  const w = googleEventWindow({ start: { date: "2026-09-19" } });
  assert(w.end > w.start, "an all-day event with no end still makes a valid window");
  assert(appDateKey(w.end) === "2026-09-19", "...covering the day it names");
}

if (failures > 0) {
  console.error(`\n${failures} google event test(s) failed`);
  process.exit(1);
}
console.log("\nAll google event tests passed");
