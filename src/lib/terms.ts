/** Terms: the named date ranges the AD defines once in Settings.
 *
 * Before this, every range in the app was a hardcoded count of weeks —
 * "18 weeks of conflicts", "20 weeks of space bookings", "search the next 4
 * weeks". That meant nothing could reach backwards, and the numbers drifted
 * from the actual academic calendar. A term is the real unit the team thinks
 * in, so it is what the app asks for. */

import { prisma } from "@/lib/prisma";
import { calendarDateFromInput, calendarDateKey } from "@/lib/dates";
import {
  EARLIEST_SUPPORTED_DATE,
  appDateKey,
  clampToSupportedRange,
  parseAppDateTime,
} from "@/lib/timezone";

export type TermRange = {
  id: string;
  name: string;
  /** Inclusive first day, "YYYY-MM-DD". */
  startKey: string;
  /** Inclusive last day, "YYYY-MM-DD". */
  endKey: string;
  isCurrent: boolean;
};

/** A term as a half-open instant range, which is what queries and calendar
 * syncs actually need: `start <= x < end`, with `end` being midnight after
 * the term's last day so that day is fully included. */
export type TermInstants = {
  start: Date;
  end: Date;
};

export async function listTerms(): Promise<TermRange[]> {
  const rows = await prisma.term.findMany({ orderBy: { startDate: "desc" } });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    startKey: calendarDateKey(t.startDate),
    endKey: calendarDateKey(t.endDate),
    isCurrent: t.isCurrent,
  }));
}

/** The term the app defaults to: whichever is flagged current, else the one
 * containing today, else the most recent. Null only when none exist yet. */
export async function currentTerm(): Promise<TermRange | null> {
  const terms = await listTerms();
  if (terms.length === 0) return null;

  const flagged = terms.find((t) => t.isCurrent);
  if (flagged) return flagged;

  const today = appDateKey(new Date());
  const containing = terms.find(
    (t) => t.startKey <= today && today <= t.endKey,
  );
  return containing ?? terms[0];
}

/** Turns a term into the instant range to query or sync over.
 *
 * The start is clamped to the earliest supported date so a term typed with a
 * wrong year can't drag a decade of Google Calendar history into the
 * database. */
export function termInstants(term: TermRange): TermInstants {
  return {
    start: clampToSupportedRange(parseAppDateTime(term.startKey)),
    // Midnight after the last day, so the last day counts in full.
    end: parseAppDateTime(nextDayKey(term.endKey)),
  };
}

/** The range to use when no term is defined yet — the current calendar year
 * from the support floor onwards, so the app still works before Settings has
 * been filled in and retroactive entry works immediately. */
export function fallbackRange(): TermInstants {
  const now = new Date();
  const year = Number(appDateKey(now).slice(0, 4));
  return {
    start: clampToSupportedRange(parseAppDateTime(`${year}-01-01`)),
    end: parseAppDateTime(`${year + 1}-01-01`),
  };
}

/** The range a screen should use: the named term if there is one, otherwise
 * the fallback. Every calendar sync and slot search goes through here. */
export async function activeRange(termId?: string): Promise<{
  range: TermInstants;
  term: TermRange | null;
}> {
  const term = termId
    ? ((await listTerms()).find((t) => t.id === termId) ?? null)
    : await currentTerm();
  return {
    range: term ? termInstants(term) : fallbackRange(),
    term,
  };
}

/** Validates what the AD typed. Returns an error string, or null if fine. */
export function validateTermDates(
  startKey: string,
  endKey: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startKey)) return "Start date is not a date.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endKey)) return "End date is not a date.";
  if (endKey < startKey) return "The term ends before it starts.";

  const floor = calendarDateKey(EARLIEST_SUPPORTED_DATE);
  if (startKey < floor) {
    return `The app only holds dates from ${floor} onwards.`;
  }
  return null;
}

export function termDateToStored(dateKey: string): Date {
  return calendarDateFromInput(dateKey);
}

function nextDayKey(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
