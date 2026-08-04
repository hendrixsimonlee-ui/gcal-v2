/** Monday-based week helpers, resolved in the app's own timezone.
 *
 * These names and signatures are unchanged from when they read the server's
 * local clock; only the implementations moved onto `timezone.ts`. That keeps
 * every existing call site correct without touching it. See that module for
 * why Eastern is pinned rather than inherited from the machine. */

import {
  APP_TIME_ZONE,
  addDaysInApp,
  appDateKey,
  parseAppDateTime,
  startOfWeekInApp,
} from "./timezone";

export function startOfWeek(date: Date): Date {
  return startOfWeekInApp(date);
}

export function addDays(date: Date, days: number): Date {
  return addDaysInApp(date, days);
}

export function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

/** Turns a "YYYY-MM-DD" into the value to store in a Prisma `@db.Date`
 * column. Anchored at UTC midnight on purpose: `@db.Date` holds a bare
 * calendar date with no time and no zone, so it only round-trips if it is
 * written and read against the same anchor. Deliberately not Eastern — what
 * matters is that it pairs with `calendarDateKey` below. */
export function calendarDateFromInput(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** The calendar date held in a `@db.Date` column, as "YYYY-MM-DD". Reads the
 * UTC parts to match how `calendarDateFromInput` wrote it — local getters
 * would shift the day west of Greenwich. */
export function calendarDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The Monday of the week a `@db.Date` value falls in, as "YYYY-MM-DD".
 * Used to group one-off space changes into weeks. */
export function calendarWeekStartKey(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

/** Formatter for `@db.Date` values. Pinned to UTC to match their anchor. */
export const calendarDateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** An instant as the "YYYY-MM-DD" URL parameter for the day it falls on,
 * read in Eastern so late-evening navigation doesn't jump a day. */
export function toDateParam(date: Date): string {
  return appDateKey(date);
}

export function parseWeekParam(value: string | undefined): Date {
  if (value) {
    const parsed = parseAppDateTime(value);
    if (!Number.isNaN(parsed.getTime())) {
      return startOfWeek(parsed);
    }
  }
  return startOfWeek(new Date());
}

const weekLabelFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: APP_TIME_ZONE,
});

export function formatWeekLabel(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6);
  return `${weekLabelFormatter.format(weekStart)} – ${weekLabelFormatter.format(weekEnd)}`;
}

const utcWeekLabelFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** Week label for a Monday key produced by `calendarWeekStartKey`. Reads in
 * UTC to match how those keys are anchored. */
export function formatCalendarWeekLabel(weekStartKey: string): string {
  const start = new Date(`${weekStartKey}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${utcWeekLabelFormatter.format(start)} – ${utcWeekLabelFormatter.format(end)}`;
}
