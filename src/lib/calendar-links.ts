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
