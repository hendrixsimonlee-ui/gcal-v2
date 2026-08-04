"use server";

/** The shared spaces calendar: one calendar carrying every room's bookings.
 *
 * This inverts the old flow. Before, the AD created a space and then linked
 * a calendar to it, one calendar per room. Now the calendar comes first: sync
 * it for a term, and the app works out which rooms exist from the event
 * titles, grouping loose spellings of the same room together.
 *
 * One event on that calendar means "we have this room, for this block". */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { calendarDateFromInput } from "@/lib/dates";
import {
  fetchCalendarBlocks,
  listGoogleCalendarsForUser,
  type GoogleCalendarSummary,
} from "@/lib/google-calendar";
import {
  groupTitles,
  spaceMatchKey,
  stripBookingNotes,
  suggestedSpaceName,
} from "@/lib/space-matching";
import { activeRange } from "@/lib/terms";

export type SpacesCalendarSyncResult = {
  /** Windows written, per room the AD already has. */
  added: number;
  updated: number;
  removed: number;
  /** Titles that matched no known room and are now waiting in the review
   * list. Nothing was created for these. */
  needsReview: { rawTitle: string; eventCount: number }[];
  /** All-day entries, which are notes rather than bookings. */
  skippedAllDay: number;
  /** Rooms already in the app whose names reduce to the same thing. The
   * older one is being used; these are the ones to merge or rename. */
  duplicateSpaces: { keptName: string; alsoMatching: string[] }[];
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
  revalidatePath("/admin/settings");
}

export async function clearSpacesCalendar() {
  await requireAdmin();
  await prisma.appSettings.update({
    where: { id: "singleton" },
    data: { spacesCalendarId: null, spacesCalendarName: null },
  });
  revalidatePath("/admin/spaces");
  revalidatePath("/admin/settings");
}

/** Reads the shared calendar over a term and turns every event into a window
 * on the room its title names.
 *
 * Rooms the AD hasn't got yet are *not* created — their titles go to the
 * review list, so "Platt B" showing up for the first time is a decision
 * rather than a surprise. Everything else imports immediately. */
export async function syncSpacesCalendar(
  termId?: string,
): Promise<SpacesCalendarSyncResult> {
  const admin = await requireAdmin();

  const settings = await prisma.appSettings.findUnique({
    where: { id: "singleton" },
    select: { spacesCalendarId: true },
  });
  if (!settings?.spacesCalendarId) {
    throw new Error("Link the spaces calendar in Settings first");
  }

  const { range, term } = await activeRange(termId);

  const { blocks, skippedAllDay } = await fetchCalendarBlocks(
    admin.id,
    settings.spacesCalendarId,
    range.start,
    range.end,
  );

  // Which rooms do we know about, by match key?
  //
  // Ordered oldest first so the mapping is stable run to run. Where two rooms
  // reduce to the same key — "EM SACHS" and "Em Sachs Theater" — the older
  // one wins and the rest are reported, because that is a duplicate the AD
  // should merge rather than something the sync should quietly pick between.
  const spaces = await prisma.space.findMany({
    select: { id: true, name: true, matchKey: true },
    orderBy: { createdAt: "asc" },
  });
  const spaceByKey = new Map<string, string>();
  const duplicateSpaces: { keptName: string; alsoMatching: string[] }[] = [];
  const nameById = new Map(spaces.map((s) => [s.id, s.name]));

  for (const space of spaces) {
    const key = space.matchKey ?? spaceMatchKey(space.name);
    if (!key) continue;
    const existingId = spaceByKey.get(key);
    if (existingId) {
      const group = duplicateSpaces.find(
        (d) => d.keptName === nameById.get(existingId),
      );
      if (group) group.alsoMatching.push(space.name);
      else
        duplicateSpaces.push({
          keptName: nameById.get(existingId) ?? "",
          alsoMatching: [space.name],
        });
      continue;
    }
    spaceByKey.set(key, space.id);
  }

  // A title already resolved in review points at its room too, so the AD only
  // answers once.
  const resolved = await prisma.spaceNameReview.findMany({
    where: { resolvedSpaceId: { not: null } },
    select: { matchKey: true, resolvedSpaceId: true },
  });
  for (const row of resolved) {
    spaceByKey.set(row.matchKey, row.resolvedSpaceId!);
  }
  const ignoredKeys = new Set(
    (
      await prisma.spaceNameReview.findMany({
        where: { ignored: true },
        select: { matchKey: true },
      })
    ).map((r) => r.matchKey),
  );

  const known: { spaceId: string; block: (typeof blocks)[number] }[] = [];
  const unknownTitles: string[] = [];

  for (const block of blocks) {
    const key = spaceMatchKey(stripBookingNotes(block.title));
    if (!key) continue;
    const spaceId = spaceByKey.get(key);
    if (spaceId) known.push({ spaceId, block });
    else if (!ignoredKeys.has(key)) unknownTitles.push(block.title);
  }

  // Queue anything unrecognised for the AD, with a count so a real room is
  // distinguishable from a typo.
  const groups = groupTitles(unknownTitles);
  for (const group of groups) {
    await prisma.spaceNameReview.upsert({
      where: { matchKey: group.matchKey },
      create: {
        matchKey: group.matchKey,
        rawTitle: group.displayTitle,
        eventCount: group.eventCount,
      },
      update: {
        rawTitle: group.displayTitle,
        eventCount: group.eventCount,
      },
    });
  }

  // Replace this calendar's imported windows for the term. Windows the AD
  // typed by hand have no source event id and are never touched.
  const existing = await prisma.spaceAvailability.findMany({
    where: {
      sourceGoogleEventId: { not: null },
      date: { gte: range.start, lt: range.end },
    },
    select: {
      id: true,
      spaceId: true,
      sourceGoogleEventId: true,
      startTime: true,
      endTime: true,
      date: true,
    },
  });
  const existingByEventId = new Map(
    existing.map((row) => [row.sourceGoogleEventId!, row]),
  );

  let added = 0;
  let updated = 0;

  for (const { spaceId, block } of known) {
    const row = existingByEventId.get(block.eventId);
    const data = {
      spaceId,
      date: calendarDateFromInput(block.date),
      isAvailable: true,
      startTime: block.startTime,
      endTime: block.endTime,
      sourceGoogleEventId: block.eventId,
    };

    if (row) {
      existingByEventId.delete(block.eventId);
      const unchanged =
        row.spaceId === data.spaceId &&
        row.startTime === data.startTime &&
        row.endTime === data.endTime &&
        row.date?.toISOString() === data.date.toISOString();
      if (!unchanged) {
        await prisma.spaceAvailability.update({ where: { id: row.id }, data });
        updated++;
      }
    } else {
      await prisma.spaceAvailability.create({ data });
      added++;
    }
  }

  // Anything imported before and no longer on the calendar has been cancelled.
  const staleIds = Array.from(existingByEventId.values()).map((r) => r.id);
  if (staleIds.length > 0) {
    await prisma.spaceAvailability.deleteMany({
      where: { id: { in: staleIds } },
    });
  }

  revalidatePath("/admin/spaces");
  revalidatePath("/admin/schedule-builder");

  return {
    added,
    updated,
    removed: staleIds.length,
    needsReview: groups.map((g) => ({
      rawTitle: g.displayTitle,
      eventCount: g.eventCount,
    })),
    skippedAllDay,
    duplicateSpaces,
    termName: term?.name ?? null,
  };
}

/** Turns a reviewed title into a new room. */
export async function createSpaceFromReview(reviewId: string) {
  await requireAdmin();
  const review = await prisma.spaceNameReview.findUniqueOrThrow({
    where: { id: reviewId },
  });

  const space = await prisma.space.create({
    data: {
      name: suggestedSpaceName(review.rawTitle),
      matchKey: review.matchKey,
    },
  });
  await prisma.spaceNameReview.update({
    where: { id: reviewId },
    data: { resolvedSpaceId: space.id },
  });

  revalidatePath("/admin/spaces");
}

/** Files a reviewed title under a room that already exists — the answer to
 * "Platt B is what we call Platt Studio B". */
export async function mapReviewToSpace(reviewId: string, spaceId: string) {
  await requireAdmin();
  await prisma.spaceNameReview.update({
    where: { id: reviewId },
    data: { resolvedSpaceId: spaceId },
  });
  revalidatePath("/admin/spaces");
}

/** Marks a title as not a room, so it stops being offered. */
export async function ignoreReview(reviewId: string) {
  await requireAdmin();
  await prisma.spaceNameReview.update({
    where: { id: reviewId },
    data: { ignored: true, resolvedSpaceId: null },
  });
  revalidatePath("/admin/spaces");
}

/** Puts an ignored or resolved title back in the queue. */
export async function reopenReview(reviewId: string) {
  await requireAdmin();
  await prisma.spaceNameReview.update({
    where: { id: reviewId },
    data: { ignored: false, resolvedSpaceId: null },
  });
  revalidatePath("/admin/spaces");
}
