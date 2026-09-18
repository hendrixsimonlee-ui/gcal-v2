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
  zonedParts,
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

/** Formats a `@db.Date` value for display — a birthday, an away window, a
 * room booking's day.
 *
 * Use this and never a plain `Intl.DateTimeFormat` for these columns. A
 * `@db.Date` holds a bare calendar day with no time and no zone, and Prisma
 * hands it back anchored at UTC midnight. Reading that with the app's Eastern
 * formatter lands at 8pm the *previous* evening, so "away on the 19th and
 * 20th" displays as the 18th and 19th — which is exactly what people
 * reported, twice, on two different screens.
 *
 * Forcing UTC here reads the day back the same way it was written. The
 * options are yours; the zone is not.
 *
 * This is only for date-only columns. A real instant — a practice start, a
 * conflict — is a moment in time and must still be read in Eastern. */
export function calendarDateFormatter(
  options: Omit<Intl.DateTimeFormatOptions, "timeZone">,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
}

/** The Monday of the week a `@db.Date` value falls in, as "YYYY-MM-DD".
 * Used to group one-off space changes into weeks. */
export function calendarWeekStartKey(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}


/** An instant as the "YYYY-MM-DD" URL parameter for the day it falls on,
 * read in Eastern so late-evening navigation doesn't jump a day. */
export function toDateParam(date: Date): string {
  return appDateKey(date);
}

/** When the conflicts screens roll onto the next week, Eastern.
 *
 * 6am Monday, not midnight. Somebody opening the app late on Sunday night is
 * still thinking about the week they were being chased about; jumping them a
 * week ahead while they are mid-thought is how people submit for the wrong
 * week. */
const CONFLICT_WEEK_ROLLOVER_HOUR = 6;

/** Which week the conflicts screens open on when nobody has picked one.
 *
 * **Next** week, not this one. The schedule is built a week ahead, so what
 * the AD needs on Thursday is everybody's conflicts for the week starting the
 * following Monday — and that is exactly the week the reminders chase. Having
 * the page open on the week that has already been scheduled meant people
 * filled in a week nobody was going to use, then wondered why their conflicts
 * were ignored.
 *
 * Both conflicts screens use this, the dancer's and the AD's, so the two are
 * never looking at different weeks while talking to each other.
 *
 * It only sets the *starting* week. The date bar still moves freely in both
 * directions, and any week can still be submitted. */
export function defaultConflictWeek(now: Date = new Date()): Date {
  const thisWeek = startOfWeek(now);
  const here = zonedParts(now);
  const beforeRollover =
    here.weekday === 1 && here.hour < CONFLICT_WEEK_ROLLOVER_HOUR;
  return beforeRollover ? thisWeek : addDays(thisWeek, 7);
}

/** `parseWeekParam`, but falling back to next week rather than this one.
 *
 * Deliberately separate: Spaces and the calendar feed mean "the week I am
 * looking at now" by default, and moving them a week forward would be wrong.
 * Only the conflicts screens look ahead. */
export function parseConflictWeekParam(value: string | undefined): Date {
  if (value) {
    const parsed = parseAppDateTime(value);
    if (!Number.isNaN(parsed.getTime())) {
      return startOfWeek(parsed);
    }
  }
  return defaultConflictWeek();
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
