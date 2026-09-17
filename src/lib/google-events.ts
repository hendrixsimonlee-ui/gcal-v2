import { parseAppDateTime } from "@/lib/timezone";

/** The shape of the bits of a Google Calendar event we read. */
export interface GoogleEventTime {
  dateTime?: string | null;
  date?: string | null;
}

/** The instant range a Google event covers, timed or all-day.
 *
 * All-day entries used to be thrown away, on the reasoning that "busy
 * Tuesday" doesn't say which hours — there was a separate out-of-town feature
 * for whole days. That feature is gone: people kept not using it, and an
 * all-day event is what they reach for anyway. So an all-day entry now means
 * the whole day, which is what somebody means when they make one.
 *
 * A timed event carries `dateTime` with an offset, so it parses straight to
 * an instant. An all-day event carries `date` instead — a bare "YYYY-MM-DD"
 * with no time and no zone — and its `end.date` is *exclusive*: one day on
 * the 19th arrives as start 2026-09-19, end 2026-09-20.
 *
 * Both ends go through the app's Eastern parser, so "all day Saturday" means
 * Eastern midnight to Eastern midnight rather than UTC's, and the exclusive
 * end lands exactly on the close of the last day with no arithmetic. It also
 * means a span across the November clocks change is 49 hours, not 48 — which
 * is correct, and is the reason this doesn't just add 24 hours per day.
 *
 * Lives in its own module rather than beside the sync because that file is
 * `"use server"`, which may only export async functions — and this needs to
 * be callable from a test. */
export function googleEventWindow(event: {
  start?: GoogleEventTime | null;
  end?: GoogleEventTime | null;
}): { start: Date; end: Date } {
  if (event.start?.dateTime && event.end?.dateTime) {
    return {
      start: new Date(event.start.dateTime),
      end: new Date(event.end.dateTime),
    };
  }

  const startKey = event.start!.date!;
  // A malformed event with no end is treated as one day rather than dropped.
  const endKey = event.end?.date ?? startKey;
  const start = parseAppDateTime(startKey, "00:00");
  let end = parseAppDateTime(endKey, "00:00");
  if (end <= start) end = parseAppDateTime(startKey, "23:59");
  return { start, end };
}
