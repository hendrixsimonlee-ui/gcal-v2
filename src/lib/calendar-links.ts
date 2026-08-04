/** Builds a Google Calendar "add event" URL. This is the render endpoint,
 * not an API call — it just opens Google Calendar prefilled, so it needs no
 * OAuth scope and works even for people who never connected their calendar. */
export function googleCalendarAddUrl(opts: {
  title: string;
  start: Date;
  end: Date;
  details?: string;
  location?: string;
}): string {
  const stamp = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(
      d.getUTCHours(),
    )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${stamp(opts.start)}/${stamp(opts.end)}`,
  });
  if (opts.details) params.set("details", opts.details);
  if (opts.location) params.set("location", opts.location);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export interface IcsEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
}

/** An .ics file covering several events at once.
 *
 * "Add this week" through Google's render URL would mean one pop-up per
 * dance; a single file imports the lot in one tap and works with Apple
 * Calendar and Outlook too. */
export function buildIcs(events: IcsEvent[], calendarName: string): string {
  const stamp = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(
      d.getUTCHours(),
    )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PADT Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(calendarName)}`,
  ];

  const now = stamp(new Date());
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(event.start)}`,
      `DTEND:${stamp(event.end)}`,
      `SUMMARY:${escapeIcs(event.title)}`,
    );
    if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeIcs(event.description)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  // RFC 5545 wants CRLF line endings; some calendar apps are strict about it.
  return lines.join("\r\n");
}

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
