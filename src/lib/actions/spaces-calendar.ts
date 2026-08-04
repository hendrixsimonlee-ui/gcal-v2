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
  /** Titles that matched no known room, so the sync made the room. Their
   * bookings are imported — this list is what to rename or merge, not a
   * queue of work blocking the import. */
  needsReview: { rawTitle: string; spaceName: string; eventCount: number }[];
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
 * A title naming a room the app hasn't got yet creates that room and imports
 * its bookings in the same pass. The earlier version queued those titles for
 * review and imported nothing for them, which meant the very first sync — when
 * by definition no room is known — reported every booking as failed and left
 * the AD with an empty schedule and a list of homework.
 *
 * The review list survives as a tidy-up: rooms created this way are flagged
 * so the AD can rename "PLATT B — DANCE" to "Platt Studio B", merge it into a
 * room they already had, or say it isn't a room at all. Ignoring a title
 * deletes its imported windows, so nothing is stuck either way. */
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

  const unknownTitles: string[] = [];
  for (const block of blocks) {
    const key = spaceMatchKey(stripBookingNotes(block.title));
    if (!key || ignoredKeys.has(key) || spaceByKey.has(key)) continue;
    unknownTitles.push(block.title);
  }

  // Make the rooms the calendar is asking for, then carry on as if they'd
  // been there all along. Grouping first means "EM SACHS" and "Em Sachs
  // Theater" become one room, not two.
  const groups = groupTitles(unknownTitles);
  const createdNames = new Map<string, string>();

  for (const group of groups) {
    const name = suggestedSpaceName(group.displayTitle);
    const space = await prisma.space.create({
      data: { name, matchKey: group.matchKey },
    });
    spaceByKey.set(group.matchKey, space.id);
    createdNames.set(group.matchKey, name);

    await prisma.spaceNameReview.upsert({
      where: { matchKey: group.matchKey },
      create: {
        matchKey: group.matchKey,
        rawTitle: group.displayTitle,
        eventCount: group.eventCount,
        resolvedSpaceId: space.id,
        autoCreated: true,
      },
      update: {
        rawTitle: group.displayTitle,
        eventCount: group.eventCount,
        resolvedSpaceId: space.id,
        autoCreated: true,
      },
    });
  }

  const known: { spaceId: string; block: (typeof blocks)[number] }[] = [];
  for (const block of blocks) {
    const key = spaceMatchKey(stripBookingNotes(block.title));
    if (!key || ignoredKeys.has(key)) continue;
    const spaceId = spaceByKey.get(key);
    if (spaceId) known.push({ spaceId, block });
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
      spaceName: createdNames.get(g.matchKey) ?? g.displayTitle,
      eventCount: g.eventCount,
    })),
    skippedAllDay,
    duplicateSpaces,
    termName: term?.name ?? null,
  };
}

/** Turns a reviewed title into a new room. Only reachable for a title that
 * was previously ignored or unlinked — a sync makes the room itself. */
export async function createSpaceFromReview(reviewId: string) {
  await requireAdmin();
  const review = await prisma.spaceNameReview.findUniqueOrThrow({
    where: { id: reviewId },
  });
  if (review.resolvedSpaceId) return;

  const space = await prisma.space.create({
    data: {
      name: suggestedSpaceName(review.rawTitle),
      matchKey: review.matchKey,
    },
  });
  await prisma.spaceNameReview.update({
    where: { id: reviewId },
    data: { resolvedSpaceId: space.id, ignored: false, autoCreated: false },
  });

  revalidatePath("/admin/spaces");
}

/** Renames the room a title created, for when "PLATT B - DANCE" should read
 * "Platt Studio B". Clears the auto-created flag: the AD has looked at it. */
export async function renameReviewSpace(reviewId: string, name: string) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give the room a name");

  const review = await prisma.spaceNameReview.findUniqueOrThrow({
    where: { id: reviewId },
  });
  if (!review.resolvedSpaceId) throw new Error("That title has no room yet");

  await prisma.space.update({
    where: { id: review.resolvedSpaceId },
    data: { name: trimmed },
  });
  await prisma.spaceNameReview.update({
    where: { id: reviewId },
    data: { autoCreated: false },
  });
  revalidatePath("/admin/spaces");
}

/** Files a reviewed title under a room that already exists — the answer to
 * "Platt B is what we call Platt Studio B".
 *
 * If the sync had already made a room for this title, its imported windows
 * move across and the spare room is deleted, so merging doesn't strand a
 * term's bookings on a room nobody looks at. Only imported windows move:
 * a window the AD typed by hand belongs to whoever they typed it on. */
export async function mapReviewToSpace(reviewId: string, spaceId: string) {
  await requireAdmin();
  const review = await prisma.spaceNameReview.findUniqueOrThrow({
    where: { id: reviewId },
  });

  const orphanId =
    review.resolvedSpaceId && review.resolvedSpaceId !== spaceId
      ? review.resolvedSpaceId
      : null;

  await prisma.spaceNameReview.update({
    where: { id: reviewId },
    data: { resolvedSpaceId: spaceId, ignored: false, autoCreated: false },
  });

  if (orphanId) {
    await prisma.spaceAvailability.updateMany({
      where: { spaceId: orphanId, sourceGoogleEventId: { not: null } },
      data: { spaceId },
    });
    await prisma.practice.updateMany({
      where: { spaceId: orphanId },
      data: { spaceId },
    });
    // Safe to remove only if it was the sync's own creation and nothing
    // hand-made is left on it.
    const leftovers = await prisma.spaceAvailability.count({
      where: { spaceId: orphanId },
    });
    if (review.autoCreated && leftovers === 0) {
      await prisma.space.delete({ where: { id: orphanId } });
    }
  }

  revalidatePath("/admin/spaces");
  revalidatePath("/admin/schedule-builder");
}

/** Marks a title as not a room, so it stops being offered — and takes back
 * what the sync imported under it, since those windows were never real. */
export async function ignoreReview(reviewId: string) {
  await requireAdmin();
  const review = await prisma.spaceNameReview.findUniqueOrThrow({
    where: { id: reviewId },
  });

  if (review.resolvedSpaceId && review.autoCreated) {
    const spaceId = review.resolvedSpaceId;
    await prisma.spaceAvailability.deleteMany({
      where: { spaceId, sourceGoogleEventId: { not: null } },
    });
    const practices = await prisma.practice.count({ where: { spaceId } });
    const leftovers = await prisma.spaceAvailability.count({
      where: { spaceId },
    });
    if (practices === 0 && leftovers === 0) {
      await prisma.space.delete({ where: { id: spaceId } });
    }
  }

  await prisma.spaceNameReview.update({
    where: { id: reviewId },
    data: { ignored: true, resolvedSpaceId: null, autoCreated: false },
  });
  revalidatePath("/admin/spaces");
  revalidatePath("/admin/schedule-builder");
}

/** Puts an ignored title back in play. The next sync recreates its room and
 * re-imports its bookings. */
export async function reopenReview(reviewId: string) {
  await requireAdmin();
  await prisma.spaceNameReview.update({
    where: { id: reviewId },
    data: { ignored: false, resolvedSpaceId: null, autoCreated: false },
  });
  revalidatePath("/admin/spaces");
}
