"use server";

/** The spaces calendar is the only source of spaces.
 *
 * One Google calendar carries every room booking the team has. An event's
 * title is the room, its location is the location, and its start and end are
 * when that room is ours. Sync reads it; nothing else creates a space.
 *
 * The previous version tried to be clever — it normalised titles, grouped
 * loose spellings together, and kept a review queue for anything it couldn't
 * place. That machinery is gone. Titles are taken exactly as written, so
 * "EM SACHS" and "Em Sachs Theater" are two rooms. Keeping the titles tidy is
 * a job somebody can see themselves doing; guessing which spellings meant the
 * same room was a job nobody could check.
 *
 * Edits made in the app are written back to the calendar, so the two never
 * disagree about who has what. */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { calendarDateFromInput, calendarDateKey } from "@/lib/dates";
import {
  fetchCalendarBlocks,
  getGoogleCalendarClientForUser,
  listGoogleCalendarsForUser,
  type GoogleCalendarSummary,
} from "@/lib/google-calendar";
import { activeRange } from "@/lib/terms";
import { appDateKey, parseAppDateTime } from "@/lib/timezone";

export type SpacesCalendarSyncResult = {
  added: number;
  updated: number;
  removed: number;
  /** Rooms this sync met for the first time. Nothing to action — it's a
   * receipt, so a typo in a title is visible as a room nobody recognises. */
  newSpaces: string[];
  /** Everything the sync saw and why anything was left out. Without this,
   * "0 added" is indistinguishable from "your bookings are all-day events",
   * "the term doesn't cover those dates" and "wrong calendar" — three very
   * different problems with the same blank result. */
  eventsSeen: number;
  skippedAllDay: number;
  skippedCancelled: number;
  skippedZeroLength: number;
  skippedNoTitle: number;
  /** The window it actually searched, as plain dates. */
  rangeStartKey: string;
  rangeEndKey: string;
  termName: string | null;
};

export async function listCalendarsForAdmin(): Promise<
  { calendars: GoogleCalendarSummary[] } | { error: string }
> {
  const admin = await requireAdmin();
  try {
    return { calendars: await listGoogleCalendarsForUser(admin.id) };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Couldn't reach Google Calendar.",
    };
  }
}

export async function setSpacesCalendar(formData: FormData) {
  await requireAdmin();
  const calendarId = String(formData.get("calendarId") ?? "").trim();
  const calendarName = String(formData.get("calendarName") ?? "").trim();
  if (!calendarId) throw new Error("Pick a calendar");

  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      spacesCalendarId: calendarId,
      spacesCalendarName: calendarName || null,
    },
    update: {
      spacesCalendarId: calendarId,
      spacesCalendarName: calendarName || null,
    },
  });
  revalidatePath("/admin/spaces");
}

export async function clearSpacesCalendar() {
  await requireAdmin();
  await prisma.appSettings.update({
    where: { id: "singleton" },
    data: { spacesCalendarId: null, spacesCalendarName: null },
  });
  revalidatePath("/admin/spaces");
}

async function requireSpacesCalendarId(): Promise<string> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: "singleton" },
    select: { spacesCalendarId: true },
  });
  if (!settings?.spacesCalendarId) {
    throw new Error("Link the spaces calendar in Settings first");
  }
  return settings.spacesCalendarId;
}

/** Reads the calendar over a term and mirrors it.
 *
 * Deliberately a mirror, not a merge: a booking that has left the calendar is
 * deleted here too. Nothing in the app can outlive the event it came from. */
export async function syncSpacesCalendar(
  termId?: string,
): Promise<SpacesCalendarSyncResult> {
  const admin = await requireAdmin();
  const calendarId = await requireSpacesCalendarId();
  const { range, term } = await activeRange(termId);

  const {
    blocks,
    eventsSeen,
    skippedAllDay,
    skippedCancelled,
    skippedZeroLength,
  } = await fetchCalendarBlocks(admin.id, calendarId, range.start, range.end);
  let skippedNoTitle = 0;

  const spaces = await prisma.space.findMany({
    select: { id: true, name: true },
  });
  const spaceIdByName = new Map(spaces.map((s) => [s.name, s.id]));
  const newSpaces: string[] = [];

  const existing = await prisma.booking.findMany({
    where: { date: { gte: range.start, lt: range.end } },
    select: {
      id: true,
      spaceId: true,
      date: true,
      startTime: true,
      endTime: true,
      sourceGoogleEventId: true,
    },
  });
  const existingByEventId = new Map(
    existing.map((row) => [row.sourceGoogleEventId, row]),
  );

  let added = 0;
  let updated = 0;

  for (const block of blocks) {
    const name = block.title.trim();
    if (!name) {
      skippedNoTitle++;
      continue;
    }

    let spaceId = spaceIdByName.get(name);
    if (!spaceId) {
      // upsert, not create: the name is unique, and a second sync click or a
      // room that already exists under this exact title would otherwise abort
      // the whole run on a unique violation partway through.
      const space = await prisma.space.upsert({
        where: { name },
        update: {},
        create: { name, location: block.location || null },
      });
      spaceId = space.id;
      spaceIdByName.set(name, spaceId);
      newSpaces.push(name);
    } else if (block.location) {
      // The calendar owns the location too, so keep it current.
      await prisma.space.updateMany({
        where: { id: spaceId, location: { not: block.location } },
        data: { location: block.location },
      });
    }

    const row = existingByEventId.get(block.eventId);
    const data = {
      spaceId,
      date: calendarDateFromInput(block.date),
      startTime: block.startTime,
      endTime: block.endTime,
    };

    if (row) {
      existingByEventId.delete(block.eventId);
      const unchanged =
        row.spaceId === data.spaceId &&
        row.startTime === data.startTime &&
        row.endTime === data.endTime &&
        row.date.toISOString() === data.date.toISOString();
      if (!unchanged) {
        await prisma.booking.update({ where: { id: row.id }, data });
        updated++;
      }
    } else {
      await prisma.booking.create({
        data: { ...data, sourceGoogleEventId: block.eventId },
      });
      added++;
    }
  }

  const staleIds = Array.from(existingByEventId.values()).map((r) => r.id);
  if (staleIds.length > 0) {
    await prisma.booking.deleteMany({ where: { id: { in: staleIds } } });
  }

  // A room whose every booking has gone is no longer a room we have. Keeping
  // it would leave an empty name in every picker forever.
  await prisma.space.deleteMany({
    where: { bookings: { none: {} }, practices: { none: {} } },
  });

  // Deliberately no revalidatePath here.
  //
  // revalidatePath makes Next re-render those routes as part of this action's
  // response. If that render throws — for any reason, anywhere on the page —
  // the browser gets "An error occurred in the Server Components render" and
  // the caller's try/catch never sees it, so a sync that actually worked
  // looks like a total failure with no message. The client refetches the
  // summary and calls router.refresh() itself, which does the same job with
  // the error surfacing somewhere it can be read.
  return {
    added,
    updated,
    removed: staleIds.length,
    newSpaces,
    eventsSeen,
    skippedAllDay,
    skippedCancelled,
    skippedZeroLength,
    skippedNoTitle,
    rangeStartKey: appDateKey(range.start),
    rangeEndKey: appDateKey(new Date(range.end.getTime() - 1)),
    termName: term?.name ?? null,
  };
}

/** Edits a booking here and on the calendar, in that order.
 *
 * Google is patched first: if that fails the app keeps the old values and the
 * AD sees an error, which is the safe way round. Writing here first would
 * leave the app claiming a room the calendar never gave it. */
export async function updateBooking(
  bookingId: string,
  input: { dateKey: string; startTime: string; endTime: string; spaceName?: string },
) {
  const admin = await requireAdmin();
  const calendarId = await requireSpacesCalendarId();

  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { space: { select: { name: true } } },
  });

  if (input.startTime >= input.endTime) {
    throw new Error("The finish time has to be after the start time");
  }

  const name = (input.spaceName ?? booking.space.name).trim();
  if (!name) throw new Error("A booking needs a room name");

  const start = parseAppDateTime(input.dateKey, input.startTime);
  const end = parseAppDateTime(input.dateKey, input.endTime);

  const calendar = await getGoogleCalendarClientForUser(admin.id);
  await calendar.events.patch({
    calendarId,
    eventId: booking.sourceGoogleEventId,
    requestBody: {
      summary: name,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    },
  });

  let spaceId = booking.spaceId;
  if (name !== booking.space.name) {
    const space = await prisma.space.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    spaceId = space.id;
  }

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      spaceId,
      date: calendarDateFromInput(input.dateKey),
      startTime: input.startTime,
      endTime: input.endTime,
    },
  });

  await prisma.space.deleteMany({
    where: { bookings: { none: {} }, practices: { none: {} } },
  });

  revalidatePath("/admin/spaces");
  revalidatePath("/admin/schedule-builder");
}

/** Removes a booking from the calendar and from here. Deleting the event is
 * how a room gets closed now — there is no separate closure record. */
export async function deleteBooking(bookingId: string) {
  const admin = await requireAdmin();
  const calendarId = await requireSpacesCalendarId();

  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { sourceGoogleEventId: true },
  });

  const calendar = await getGoogleCalendarClientForUser(admin.id);
  try {
    await calendar.events.delete({
      calendarId,
      eventId: booking.sourceGoogleEventId,
    });
  } catch (error) {
    // Already gone from Google is the outcome we wanted, not a failure.
    const status = (error as { code?: number })?.code;
    if (status !== 404 && status !== 410) throw error;
  }

  await prisma.booking.delete({ where: { id: bookingId } });
  await prisma.space.deleteMany({
    where: { bookings: { none: {} }, practices: { none: {} } },
  });

  revalidatePath("/admin/spaces");
  revalidatePath("/admin/schedule-builder");
}

export interface SpaceWeekSummary {
  spaceId: string;
  spaceName: string;
  location: string | null;
  totalHours: number;
  blocks: { id: string; dateKey: string; startTime: string; endTime: string }[];
}

/** What we have, this week, per room — the sidebar summary.
 *
 * The hours total is the question the AD is actually asking when they look at
 * this: not "when is Platt free" but "how much floor do we have to hand out
 * this week". */
export async function getWeekSpaceSummary(
  weekStartIso: string,
): Promise<{ spaces: SpaceWeekSummary[]; totalHours: number }> {
  await requireAdmin();
  const weekStart = calendarDateFromInput(appDateKey(new Date(weekStartIso)));
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const bookings = await prisma.booking.findMany({
    where: { date: { gte: weekStart, lt: weekEnd } },
    include: { space: { select: { id: true, name: true, location: true } } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  const bySpace = new Map<string, SpaceWeekSummary>();
  for (const booking of bookings) {
    const entry =
      bySpace.get(booking.spaceId) ??
      ({
        spaceId: booking.spaceId,
        spaceName: booking.space.name,
        location: booking.space.location,
        totalHours: 0,
        blocks: [],
      } satisfies SpaceWeekSummary);

    entry.totalHours += minutesBetween(booking.startTime, booking.endTime) / 60;
    entry.blocks.push({
      id: booking.id,
      // calendarDateKey, not appDateKey: `date` is a @db.Date column, which
      // Postgres hands back anchored at UTC midnight. Reading that with an
      // Eastern formatter lands on the evening before, so every booking
      // displayed a day early. The Schedule Builder is unaffected because its
      // practices are real timestamps rather than date-only columns.
      dateKey: calendarDateKey(booking.date),
      startTime: booking.startTime,
      endTime: booking.endTime,
    });
    bySpace.set(booking.spaceId, entry);
  }

  const spaces = Array.from(bySpace.values()).sort(
    (a, b) => b.totalHours - a.totalHours || a.spaceName.localeCompare(b.spaceName),
  );
  return {
    spaces,
    totalHours: spaces.reduce((sum, s) => sum + s.totalHours, 0),
  };
}

function minutesBetween(startTime: string, endTime: string): number {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  return Math.max(0, toMinutes(endTime) - toMinutes(startTime));
}
