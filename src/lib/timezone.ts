/** The one clock the whole app runs on.
 *
 * Everything the team sees — when a week starts, what "today" means, the time
 * printed on a practice, when check-in opens, how many minutes late somebody
 * was, and the times read from and written to Google Calendar — is resolved
 * here rather than from whatever machine happens to be running the code.
 *
 * This matters because the server runs in UTC. Reading a Date with
 * `getHours()` on Vercel gives UTC hours, so a 7pm rehearsal read back as
 * midnight the following day, and Monday-based weeks began Sunday evening.
 *
 * IANA rather than a fixed -05:00 offset on purpose: the season spans the
 * March and November transitions, and a fixed offset would silently shift
 * every practice by an hour for two thirds of the year. `America/New_York`
 * is Eastern time as people actually experience it, EST and EDT alike.
 */
export const APP_TIME_ZONE = "America/New_York";

/** Earliest date the app will read or write. Retroactive entry is supported
 * so a season can be reconstructed after the fact, but without a floor a
 * mistyped year would pull a decade of calendar history into the database. */
export const EARLIEST_SUPPORTED_DATE = new Date("2026-01-01T00:00:00Z");

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday, matching `Date.prototype.getDay`. */
  weekday: number;
};

/** An instant, broken into the wall-clock parts an Eastern-time observer
 * would read off it. */
export function zonedParts(date: Date): ZonedParts {
  const parts = partsFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  // Midnight formats as hour 24 rather than 00 in some ICU versions.
  const hour = Number(get("hour")) % 24;

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/** How far Eastern time is from UTC at a given instant, in milliseconds.
 * Negative west of Greenwich, so -5h in winter and -4h in summer. */
function zoneOffsetMs(date: Date): number {
  const p = zonedParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Trim to whole seconds first; the parts carry no milliseconds.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant at which Eastern wall-clock time reads the given values.
 *
 * Resolved by guessing, measuring the offset that guess actually lands in,
 * and correcting — then repeating once, which settles the case where the
 * correction itself steps across a DST boundary.
 *
 * Ambiguous and skipped times (2am on the two transition Sundays) resolve to
 * a real instant rather than throwing: a practice is never scheduled then,
 * and failing hard would be worse than landing an hour either side. */
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = wallClockAsUtc - zoneOffsetMs(new Date(wallClockAsUtc));
  instant = wallClockAsUtc - zoneOffsetMs(new Date(instant));
  return new Date(instant);
}

/** "YYYY-MM-DD" for the Eastern calendar day an instant falls on. */
export function appDateKey(date: Date): string {
  const p = zonedParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "HH:mm" of an instant, as Eastern wall-clock time. */
export function appTimeKey(date: Date): string {
  const p = zonedParts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Midnight Eastern at the start of the day an instant falls on. */
export function startOfDayInApp(date: Date): Date {
  const p = zonedParts(date);
  return zonedTimeToInstant(p.year, p.month, p.day, 0, 0, 0);
}

/** The last minute of the Eastern day an instant falls on. Used to clamp a
 * calendar event that runs past midnight back to its starting day. */
export function endOfDayInApp(date: Date): Date {
  const p = zonedParts(date);
  return zonedTimeToInstant(p.year, p.month, p.day, 23, 59, 0);
}

/** Midnight Eastern on the Monday of the week an instant falls in. */
export function startOfWeekInApp(date: Date): Date {
  const p = zonedParts(date);
  const shift = p.weekday === 0 ? -6 : 1 - p.weekday;
  return zonedTimeToInstant(p.year, p.month, p.day + shift, 0, 0, 0);
}

/** Adds whole days in Eastern terms, so a span across a DST boundary still
 * lands at the same wall-clock time rather than drifting an hour. */
export function addDaysInApp(date: Date, days: number): Date {
  const p = zonedParts(date);
  return zonedTimeToInstant(
    p.year,
    p.month,
    p.day + days,
    p.hour,
    p.minute,
    p.second,
  );
}

/** Parses a "YYYY-MM-DD" (and optional "HH:mm") typed by someone in the app
 * as Eastern wall-clock time, not as UTC. */
export function parseAppDateTime(dateKey: string, timeKey = "00:00"): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = timeKey.split(":").map(Number);
  return zonedTimeToInstant(y, m, d, hh || 0, mm || 0, 0);
}

/** N minutes past midnight on the Eastern day an instant falls on.
 *
 * This is how a stored availability window ("19:00" as 1140 minutes) becomes
 * a real instant. Going through the wall clock rather than adding
 * milliseconds matters on the two DST days, where a day is 23 or 25 hours
 * long and arithmetic on the epoch would land an hour out. */
export function minutesIntoAppDay(date: Date, minutes: number): Date {
  const p = zonedParts(date);
  return zonedTimeToInstant(
    p.year,
    p.month,
    p.day,
    0,
    minutes,
    0,
  );
}

/** Whether two instants fall on the same Eastern calendar day. */
export function isSameAppDay(a: Date, b: Date): boolean {
  return appDateKey(a) === appDateKey(b);
}

/** Clamps a range start to the earliest date the app supports, so a
 * retroactive sync can reach back through 2026 but no further. */
export function clampToSupportedRange(date: Date): Date {
  return date < EARLIEST_SUPPORTED_DATE ? EARLIEST_SUPPORTED_DATE : date;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
