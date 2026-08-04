"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { calendarDateFromInput } from "@/lib/dates";
import {
  fetchCalendarBlocks,
  listGoogleCalendarsForUser,
  type GoogleCalendarSummary,
} from "@/lib/google-calendar";
import { syncPracticeToTeamCalendar } from "@/lib/team-calendar";

/** How far ahead an import reaches. A term's worth — far enough to cover the
 * whole season in one go, short enough that a stale booking from last year
 * doesn't come back. */
const IMPORT_WEEKS_AHEAD = 20;

export async function addSpace(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  if (!name) throw new Error("Space name is required");

  await prisma.space.create({ data: { name, location: location || null } });
  revalidatePath("/admin/spaces");
}

export async function deleteSpace(spaceId: string) {
  await requireAdmin();
  await prisma.space.delete({ where: { id: spaceId } });
  revalidatePath("/admin/spaces");
}

export async function addRecurringAvailability(
  spaceId: string,
  formData: FormData,
) {
  await requireAdmin();
  const dayOfWeek = Number(formData.get("dayOfWeek"));
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");

  if (
    Number.isNaN(dayOfWeek) ||
    dayOfWeek < 0 ||
    dayOfWeek > 6 ||
    !startTime ||
    !endTime
  ) {
    throw new Error("Invalid availability window");
  }
  if (startTime >= endTime) {
    throw new Error("Start time must be before end time");
  }

  await prisma.spaceAvailability.create({
    data: { spaceId, dayOfWeek, startTime, endTime },
  });
  revalidatePath("/admin/spaces");
}

/** A one-off change for a single date — the gym is closed for an event, or
 * open unusually. Overrides the recurring weekly pattern for that day. */
export async function addDateOverride(spaceId: string, formData: FormData) {
  await requireAdmin();
  const dateRaw = String(formData.get("date") ?? "");
  const closed = formData.get("closed") === "on";
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");

  const date = calendarDateFromInput(dateRaw);
  if (Number.isNaN(date.getTime())) throw new Error("Pick a valid date");

  if (!closed) {
    if (!startTime || !endTime) {
      throw new Error("Give the hours it's open, or tick 'closed all day'");
    }
    if (startTime >= endTime) {
      throw new Error("Start time must be before end time");
    }
  }

  await prisma.spaceAvailability.create({
    data: {
      spaceId,
      date,
      isAvailable: !closed,
      startTime: closed ? null : startTime,
      endTime: closed ? null : endTime,
    },
  });
  revalidatePath("/admin/spaces");
  revalidatePath("/admin/schedule-builder");
}

/** The AD's own Google calendars, for the "which calendar is this room on?"
 * picker. Returns a message instead of throwing when Google isn't connected —
 * this is a page that has to render either way. */
export async function getLinkableCalendars(): Promise<
  { calendars: GoogleCalendarSummary[] } | { error: string }
> {
  const admin = await requireAdmin();
  try {
    return { calendars: await listGoogleCalendarsForUser(admin.id) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't reach Google Calendar" };
  }
}

export async function linkSpaceCalendar(spaceId: string, formData: FormData) {
  await requireAdmin();
  const calendarId = String(formData.get("calendarId") ?? "").trim();
  const calendarName = String(formData.get("calendarName") ?? "").trim();

  await prisma.space.update({
    where: { id: spaceId },
    data: {
      googleCalendarId: calendarId || null,
      googleCalendarName: calendarId ? calendarName || calendarId : null,
    },
  });
  revalidatePath("/admin/spaces");
}

export async function unlinkSpaceCalendar(spaceId: string) {
  await requireAdmin();
  // The windows already imported stay — they're real bookings the AD may
  // have built a schedule around. Unlinking only stops future syncs.
  await prisma.space.update({
    where: { id: spaceId },
    data: { googleCalendarId: null, googleCalendarName: null },
  });
  revalidatePath("/admin/spaces");
}

export interface SpaceImportResult {
  added: number;
  updated: number;
  removed: number;
  skippedAllDay: number;
}

/** Pulls the linked calendar's events in as one-off open windows for this
 * space. Each event means "the room is ours for these hours on this date",
 * which is how a room booking calendar reads.
 *
 * Only rows this import created before are touched: hand-entered weekly hours
 * and manual one-offs are left exactly as they are, and a booking cancelled
 * in Google disappears here on the next sync. */
export async function importSpaceCalendar(
  spaceId: string,
): Promise<SpaceImportResult> {
  const admin = await requireAdmin();
  const space = await prisma.space.findUniqueOrThrow({
    where: { id: spaceId },
    select: { googleCalendarId: true },
  });
  if (!space.googleCalendarId) {
    throw new Error("Link a Google Calendar to this space first");
  }

  const rangeStart = new Date();
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + IMPORT_WEEKS_AHEAD * 7);

  const { blocks, skippedAllDay } = await fetchCalendarBlocks(
    admin.id,
    space.googleCalendarId,
    rangeStart,
    rangeEnd,
  );

  const existing = await prisma.spaceAvailability.findMany({
    where: {
      spaceId,
      sourceGoogleEventId: { not: null },
      date: { gte: rangeStart },
    },
  });
  const existingByEventId = new Map(
    existing.map((row) => [row.sourceGoogleEventId!, row]),
  );

  let added = 0;
  let updated = 0;

  for (const block of blocks) {
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

  // Anything left over was imported before and is no longer on the calendar.
  const staleIds = Array.from(existingByEventId.values()).map((r) => r.id);
  if (staleIds.length > 0) {
    await prisma.spaceAvailability.deleteMany({ where: { id: { in: staleIds } } });
  }

  revalidatePath("/admin/spaces");
  revalidatePath("/admin/schedule-builder");
  return { added, updated, removed: staleIds.length, skippedAllDay };
}

export async function deleteAvailability(availabilityId: string) {
  await requireAdmin();
  await prisma.spaceAvailability.delete({ where: { id: availabilityId } });
  revalidatePath("/admin/spaces");
  revalidatePath("/admin/schedule-builder");
}

/** Points the app at the shared team calendar every published practice gets
 * written to. Owned by the club account and shared with the AD, so it
 * survives ADs changing. */
export async function setTeamCalendar(formData: FormData) {
  await requireAdmin();
  const calendarId = String(formData.get("calendarId") ?? "").trim();
  const calendarName = String(formData.get("calendarName") ?? "").trim();

  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {
      teamCalendarId: calendarId || null,
      teamCalendarName: calendarId ? calendarName || calendarId : null,
    },
    create: {
      id: "singleton",
      teamCalendarId: calendarId || null,
      teamCalendarName: calendarId ? calendarName || calendarId : null,
    },
  });
  revalidatePath("/admin/settings");
}

/** Rewrites every upcoming published practice onto the team calendar. For
 * after linking it for the first time, or if it drifted. */
export async function resyncTeamCalendar(): Promise<number> {
  await requireAdmin();
  const practices = await prisma.practice.findMany({
    where: {
      status: "CONFIRMED",
      endDateTime: { gte: new Date() },
      dance: { archivedAt: null },
    },
    select: { id: true },
    orderBy: { startDateTime: "asc" },
  });

  let written = 0;
  for (const practice of practices) {
    if ((await syncPracticeToTeamCalendar(practice.id)) === "written") written++;
  }
  revalidatePath("/admin/settings");
  return written;
}
