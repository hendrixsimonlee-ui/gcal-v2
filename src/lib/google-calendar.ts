import { google, type calendar_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";
import {
  appDateKey,
  appTimeKey,
  endOfDayInApp,
  isSameAppDay,
} from "@/lib/timezone";

/** Which stored credentials to hand google-auth-library.
 *
 * The subtlety is when *not* to pass the access token. The library decides
 * whether to refresh with `isTokenExpiring()`, whose own source comment reads:
 * "If there is no expiry time, assumes the token is not expired or expiring."
 * So an access token stored without an expiry is treated as good forever — the
 * library sends the stale one, Google answers 401, and the perfectly valid
 * refresh token sitting next to it is never tried. `expires_at` is nullable,
 * so that state is reachable, and once reached nothing the AD can do in the
 * app recovers from it.
 *
 * Handing over the refresh token alone makes `shouldRefresh` true on the first
 * call, so the client mints a fresh access token. The cost is one extra round
 * trip in the case where we couldn't have trusted the cached token anyway. */
export function googleCredentialsFor(account: {
  access_token?: string | null;
  refresh_token: string;
  expires_at?: number | null;
}): {
  refresh_token: string;
  access_token?: string;
  expiry_date?: number;
} {
  const usable =
    typeof account.expires_at === "number" &&
    Number.isFinite(account.expires_at) &&
    Boolean(account.access_token);

  if (!usable) return { refresh_token: account.refresh_token };
  return {
    refresh_token: account.refresh_token,
    access_token: account.access_token as string,
    expiry_date: (account.expires_at as number) * 1000,
  };
}

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

  // Signing in and granting calendar access are two different things.
  //
  // Google's consent screen lists each permission with its own tick-box, and
  // they are not all ticked by default. Someone can breeze through it, land in
  // the app fully signed in, and hold a token with no calendar access at all.
  // Every calendar call then fails with a 403 about "insufficient
  // authentication scopes", which reads like the calendar is missing or
  // unshared and sends them hunting in entirely the wrong place.
  //
  // The granted scopes come back with the token and we store them, so this is
  // checkable before spending a round trip. Only enforced when we actually
  // recorded the scopes: a row saved before they were stored has scope null,
  // and refusing those would lock out people whose access is fine.
  if (account.scope && !account.scope.includes("calendar")) {
    throw new Error(
      "You're signed in, but this account didn't grant access to your " +
        "calendars. On Google's permission screen each item has its own " +
        "tick-box and the calendar ones aren't ticked for you. Sign out, sign " +
        "back in, and tick the calendar boxes before pressing Continue.",
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );

  oauth2Client.setCredentials(
    googleCredentialsFor({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expires_at: account.expires_at,
    }),
  );

  // Google hands back a refreshed access token mid-flight; save it so the next
  // request doesn't have to refresh again. Awaiting isn't possible here (the
  // callback is sync), so this is fire-and-forget — but it must never reject
  // unhandled, which on Node takes the whole server process down.
  oauth2Client.on("tokens", (tokens) => {
    void prisma.account
      .update({
        where: { id: account.id },
        data: {
          access_token: tokens.access_token ?? account.access_token,
          expires_at: tokens.expiry_date
            ? Math.floor(tokens.expiry_date / 1000)
            : account.expires_at,
          // Google occasionally reissues the refresh token. Take it when it
          // comes, keep the old one when it doesn't.
          ...(tokens.refresh_token
            ? { refresh_token: tokens.refresh_token }
            : {}),
        },
      })
      .catch((error) => {
        console.error("Couldn't save the refreshed Google token", error);
      });
  });

  return google.calendar({ version: "v3", auth: oauth2Client });
}

/** Turns Google's OAuth failures into something the AD can act on.
 *
 * `invalid_grant` in particular is the one that matters and the one that
 * reads as gibberish. It means the stored refresh token is dead, and there
 * are only a few ways that happens:
 *
 *  - The OAuth consent screen is still in **Testing** in Google Cloud. Google
 *    expires refresh tokens for unpublished apps after **7 days**, so the
 *    connection works, then stops a week later for no visible reason. This is
 *    far and away the most common cause, and the permanent fix is to publish
 *    the consent screen.
 *  - The Google client ID changed, so tokens issued by the old one are no
 *    longer recognised.
 *  - Somebody revoked the app's access, or changed their password.
 *
 * Every one of them is fixed the same way from the app's side: sign out and
 * back in, which issues a fresh token (auth.ts asks for offline access with
 * prompt=consent precisely so that works). */
export function describeGoogleError(error: unknown): Error {
  const raw =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  if (/invalid_grant/i.test(raw)) {
    return new Error(
      "Google has stopped accepting this account's saved permission. " +
        "Sign out and sign back in to reconnect. If it keeps happening every " +
        "few days, the OAuth consent screen in Google Cloud is still set to " +
        "Testing — published apps keep their access, apps in Testing lose it " +
        "after 7 days.",
    );
  }
  if (/invalid_request/i.test(raw)) {
    return new Error(
      "Google turned the request down before checking the account. That " +
        "almost always means GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is " +
        "missing or mistyped in the Vercel environment variables.",
    );
  }
  if (/invalid credentials|unauthorized|\b401\b/i.test(raw)) {
    return new Error(
      "Google rejected this account's access token. Sign out and sign back " +
        "in to reconnect — that reissues it.",
    );
  }
  if (/invalid_client/i.test(raw)) {
    return new Error(
      "Google rejected the app's credentials. Check GOOGLE_CLIENT_ID and " +
        "GOOGLE_CLIENT_SECRET in the Vercel environment variables.",
    );
  }
  // Two very different problems both arrive as 403, and the advice for one is
  // useless for the other. "Insufficient scopes" is about the permission this
  // account granted at sign-in; a plain forbidden is about who the calendar is
  // shared with. Telling someone to check sharing when the real problem is an
  // unticked consent box sends them somewhere they can't fix it.
  if (/insufficient|insufficientPermissions|scope/i.test(raw)) {
    return new Error(
      "This account is signed in but hasn't granted calendar access. On " +
        "Google's permission screen each item has its own tick-box — sign " +
        "out, sign back in, and tick the calendar ones.",
    );
  }
  if (/accessNotConfigured|has not been used in project/i.test(raw)) {
    return new Error(
      "The Google Calendar API isn't switched on for this project. Enable it " +
        "in Google Cloud Console under APIs & Services, then try again.",
    );
  }
  if (/forbidden|\b403\b/i.test(raw)) {
    return new Error(
      "Google says this account can't see that calendar. Make sure it's " +
        "shared with the club account, with at least 'See all event details'.",
    );
  }
  if (/notFound|\b404\b/i.test(raw)) {
    return new Error(
      "That calendar no longer exists, or isn't shared with this account any more.",
    );
  }
  return error instanceof Error ? error : new Error(raw);
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
  const { data } = await calendar.calendarList
    .list({ maxResults: 250 })
    .catch((error) => {
      throw describeGoogleError(error);
    });

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
    const { data } = await calendar.events
      .list({
        calendarId,
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 2500,
        pageToken,
      })
      .catch((error) => {
        throw describeGoogleError(error);
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
): Promise<{
  blocks: GoogleCalendarBlock[];
  /** Everything the calendar returned in range, before any filtering. When a
   * sync imports nothing, the first question is whether it saw nothing or
   * threw everything away — these counts answer it. */
  eventsSeen: number;
  skippedAllDay: number;
  skippedCancelled: number;
  skippedZeroLength: number;
}> {
  const calendar = await getGoogleCalendarClientForUser(userId);
  const events = await listAllEvents(calendar, calendarId, rangeStart, rangeEnd);

  const blocks: GoogleCalendarBlock[] = [];
  let skippedAllDay = 0;
  let skippedCancelled = 0;
  let skippedZeroLength = 0;

  for (const event of events) {
    if (!event.id) continue;
    if (event.status === "cancelled") {
      skippedCancelled++;
      continue;
    }
    if (!event.start?.dateTime || !event.end?.dateTime) {
      skippedAllDay++;
      continue;
    }

    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);
    if (end <= start) {
      skippedZeroLength++;
      continue;
    }

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

  return {
    blocks,
    eventsSeen: events.length,
    skippedAllDay,
    skippedCancelled,
    skippedZeroLength,
  };
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
