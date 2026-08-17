import { google, type calendar_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";
import {
  appDateKey,
  appTimeKey,
  endOfDayInApp,
  isSameAppDay,
} from "@/lib/timezone";

/** Builds an authenticated Calendar client from the tokens stored on the
 * user's Google account (captured at sign-in, since we request the
 * calendar.readonly scope up front). Persists refreshed access tokens back
 * to the Account row so the next import doesn't need a fresh consent. */
export async function getGoogleCalendarClientForUser(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });
  if (!account?.refresh_token) {
    throw new Error(
      "Google Calendar isn't connected for this account. Sign out and back in to grant access.",
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({
    access_token: account.access_token ?? undefined,
    refresh_token: account.refresh_token,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  });

  oauth2Client.on("tokens", (tokens) => {
    void prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: tokens.access_token ?? account.access_token,
        expires_at: tokens.expiry_date
          ? Math.floor(tokens.expiry_date / 1000)
          : account.expires_at,
      },
    });
  });

  return google.calendar({ version: "v3", auth: oauth2Client });
}

export interface GoogleCalendarSummary {
  id: string;
  name: string;
  primary: boolean;
}

/** Every calendar the signed-in user can read, so the AD can pick the one a
 * room's bookings live on instead of hunting down its calendar ID. */
export async function listGoogleCalendarsForUser(
  userId: string,
): Promise<GoogleCalendarSummary[]> {
  const calendar = await getGoogleCalendarClientForUser(userId);
  const { data } = await calendar.calendarList.list({ maxResults: 250 });

  return (data.items ?? [])
    .filter((item): item is typeof item & { id: string } => Boolean(item.id))
    .map((item) => ({
      id: item.id,
      name: item.summary ?? item.id,
      primary: item.primary ?? false,
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
}

/** Every timed event on a calendar in a range, following `nextPageToken`.
 *
 * Google caps `events.list` at 2500 results per page and hands back a token
 * for the rest. A single call therefore looks successful while silently
 * dropping everything past the first page — which is exactly what a whole
 * term of room bookings, or a busy student's year of classes, will be. The
 * page size stays at 2500 so the common case is still one round trip.
 *
 * The guard is a safety rail, not a limit anyone should hit: 40 pages is
 * 100,000 events. If a token ever came back forever, this stops rather than
 * looping until the function times out. */
export async function listAllEvents(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<calendar_v3.Schema$Event[]> {
  const items: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const { data } = await calendar.events.list({
      calendarId,
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 2500,
      pageToken,
    });
    items.push(...(data.items ?? []));
    pageToken = data.nextPageToken ?? undefined;
    pages++;
  } while (pageToken && pages < 40);

  return items;
}

export interface GoogleCalendarBlock {
  eventId: string;
  /** Calendar date as YYYY-MM-DD, in the viewer's timezone. */
  date: string;
  /** "HH:mm" local start/end. */
  startTime: string;
  endTime: string;
  title: string;
  /** The event's own location field, which the app takes as the room's. */
  location: string | null;
}

/** Timed events on a calendar over a date range, flattened into date +
 * local start/end times — the shape a space availability window needs.
 *
 * All-day events are skipped: a room calendar's all-day entries are notes
 * ("Finals week"), not bookable blocks, and guessing hours for them would
 * invent availability nobody granted. Events that straddle midnight are
 * clamped to their start date for the same reason — the AD can split them by
 * hand if a room really is open overnight. */
export async function fetchCalendarBlocks(
  userId: string,
  calendarId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<{ blocks: GoogleCalendarBlock[]; skippedAllDay: number }> {
  const calendar = await getGoogleCalendarClientForUser(userId);
  const events = await listAllEvents(calendar, calendarId, rangeStart, rangeEnd);

  const blocks: GoogleCalendarBlock[] = [];
  let skippedAllDay = 0;

  for (const event of events) {
    if (!event.id) continue;
    if (event.status === "cancelled") continue;
    if (!event.start?.dateTime || !event.end?.dateTime) {
      skippedAllDay++;
      continue;
    }

    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);
    if (end <= start) continue;

    const sameDayEnd =
      isSameAppDay(end, start)
        ? end
        : endOfLocalDay(start);

    blocks.push({
      eventId: event.id,
      date: localDateKey(start),
      startTime: localTime(start),
      endTime: localTime(sameDayEnd),
      title: event.summary ?? "Booked",
      location: event.location ?? null,
    });
  }

  return { blocks, skippedAllDay };
}

/** These three used to read the server's clock, which on Vercel is UTC — a
 * 7pm rehearsal block imported as midnight the following day. They now
 * resolve in the app's timezone, so what the calendar shows and what the app
 * stores are the same wall-clock time. */

function endOfLocalDay(date: Date): Date {
  return endOfDayInApp(date);
}

function localDateKey(date: Date): string {
  return appDateKey(date);
}

function localTime(date: Date): string {
  return appTimeKey(date);
}
