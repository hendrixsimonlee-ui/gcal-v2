"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUser } from "@/lib/authz";
import { startOfWeek, addDays } from "@/lib/dates";
import { clampToSupportedRange } from "@/lib/timezone";
import { activeRange } from "@/lib/terms";
import {
  getGoogleCalendarClientForUser,
  listGoogleCalendarsForUser,
  type GoogleCalendarSummary,
} from "@/lib/google-calendar";

// Recurring conflicts are materialized as independent rows up front (rather
// than projected on read) so each week's instance is directly editable or
// deletable by the dancer or the AD, per the "AD has admin access over
// these conflicts" requirement.
const RECURRING_WEEKS_AHEAD = 10;

/** Adds a conflict (and its future weekly occurrences, if recurring).
 * Called from the calendar's drag-to-create and its add panel. */
export async function addConflict(input: {
  startDateTime: string;
  endDateTime: string;
  title: string;
  isRecurring: boolean;
}) {
  const session = await auth();
  const userId = session!.user.id;

  const start = new Date(input.startDateTime);
  const end = new Date(input.endDateTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Please provide a valid start and end time");
  }
  if (start >= end) {
    throw new Error("Start time must be before end time");
  }

  const occurrences = input.isRecurring ? RECURRING_WEEKS_AHEAD : 1;
  await prisma.conflict.createMany({
    data: Array.from({ length: occurrences }, (_, i) => {
      const occStart = addDays(start, i * 7);
      const occEnd = addDays(end, i * 7);
      return {
        userId,
        weekOf: startOfWeek(occStart),
        startDateTime: occStart,
        endDateTime: occEnd,
        title: input.title.trim() || null,
        isRecurring: input.isRecurring,
        recurrenceRule: input.isRecurring ? "WEEKLY" : null,
      };
    }),
  });
  revalidatePath("/conflicts");
}

/** Drag/resize on the calendar. Moves only this occurrence — a recurring
 * conflict's other weeks are separate rows and stay put. */
export async function updateConflictTime(
  conflictId: string,
  startDateTime: string,
  endDateTime: string,
) {
  const session = await auth();
  const conflict = await prisma.conflict.findUniqueOrThrow({
    where: { id: conflictId },
  });
  if (conflict.userId !== session!.user.id && !session!.user.isAdmin) {
    throw new Error("Not authorized to edit this conflict");
  }

  const start = new Date(startDateTime);
  const end = new Date(endDateTime);
  if (start >= end) throw new Error("Start time must be before end time");

  await prisma.conflict.update({
    where: { id: conflictId },
    data: {
      startDateTime: start,
      endDateTime: end,
      weekOf: startOfWeek(start),
    },
  });
  revalidatePath("/conflicts");
  revalidatePath("/admin/conflicts");
  revalidatePath("/admin/roster");
}

export async function deleteConflict(conflictId: string) {
  const session = await auth();
  const conflict = await prisma.conflict.findUniqueOrThrow({
    where: { id: conflictId },
  });
  if (conflict.userId !== session!.user.id && !session!.user.isAdmin) {
    throw new Error("Not authorized to delete this conflict");
  }
  await prisma.conflict.delete({ where: { id: conflictId } });
  revalidatePath("/conflicts");
  revalidatePath("/admin/conflicts");
}

/** Rename a conflict. The title is all a dancer supplies now, so it's the
 * only thing they can edit besides the time. */
export async function updateConflictTitle(conflictId: string, title: string) {
  const session = await auth();
  const conflict = await prisma.conflict.findUniqueOrThrow({
    where: { id: conflictId },
  });
  if (conflict.userId !== session!.user.id && !session!.user.isAdmin) {
    throw new Error("Not authorized to edit this conflict");
  }
  await prisma.conflict.update({
    where: { id: conflictId },
    data: { title: title.trim() || null },
  });
  revalidatePath("/conflicts");
  revalidatePath("/admin/conflicts");
}

/** The AD's call on one conflict. Dancers don't categorise anything any more;
 * excused vs unexcused is entirely the AD's, and NOT_REVIEWED is a real state
 * so the review screen can show what hasn't been looked at. */
export async function setConflictStatus(
  conflictId: string,
  status: "NOT_REVIEWED" | "EXCUSED" | "UNEXCUSED",
) {
  const admin = await requireAdmin();
  await prisma.conflict.update({
    where: { id: conflictId },
    data: {
      status,
      reviewedById: status === "NOT_REVIEWED" ? null : admin.id,
      reviewedAt: status === "NOT_REVIEWED" ? null : new Date(),
    },
  });
  revalidatePath("/admin/conflicts");
  revalidatePath("/conflicts");
  revalidatePath("/admin/schedule-builder");
}

/** Mark everything one person logged in a week at once — the common case
 * when their whole week is classes. */
export async function setWeekConflictStatus(
  userId: string,
  weekOfIso: string,
  status: "EXCUSED" | "UNEXCUSED",
) {
  const admin = await requireAdmin();
  await prisma.conflict.updateMany({
    where: { userId, weekOf: startOfWeek(new Date(weekOfIso)) },
    data: { status, reviewedById: admin.id, reviewedAt: new Date() },
  });
  revalidatePath("/admin/conflicts");
  revalidatePath("/admin/schedule-builder");
}

export async function addUnavailability(formData: FormData) {
  const session = await auth();
  const userId = session!.user.id;

  const startDate = new Date(String(formData.get("startDate") ?? ""));
  const endDate = new Date(String(formData.get("endDate") ?? ""));
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("Please provide valid dates");
  }
  if (startDate > endDate) {
    throw new Error("Start date must be before end date");
  }

  await prisma.unavailability.create({
    data: { userId, startDate, endDate, reason },
  });
  revalidatePath("/conflicts");
}

export async function deleteUnavailability(unavailabilityId: string) {
  const session = await auth();
  const record = await prisma.unavailability.findUniqueOrThrow({
    where: { id: unavailabilityId },
  });
  if (record.userId !== session!.user.id && !session!.user.isAdmin) {
    throw new Error("Not authorized to delete this");
  }
  await prisma.unavailability.delete({ where: { id: unavailabilityId } });
  revalidatePath("/conflicts");
}

/** The signed-in person's own Google calendars, so they can say which one is
 * their PADT conflict calendar. Returns the failure as a value rather than
 * throwing — the Conflicts page has to render whether or not Google is
 * reachable. */
export async function getMyCalendars(): Promise<
  { calendars: GoogleCalendarSummary[] } | { error: string }
> {
  const user = await requireUser();
  try {
    return { calendars: await listGoogleCalendarsForUser(user.id) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Couldn't reach Google Calendar",
    };
  }
}

export async function setConflictCalendar(formData: FormData) {
  const user = await requireUser();
  const calendarId = String(formData.get("calendarId") ?? "").trim();
  const calendarName = String(formData.get("calendarName") ?? "").trim();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      conflictCalendarId: calendarId || null,
      conflictCalendarName: calendarId ? calendarName || calendarId : null,
    },
  });
  revalidatePath("/conflicts");
}

export interface ConflictSyncResult {
  added: number;
  updated: number;
  removed: number;
  calendarName: string;
}

/** Pulls conflicts in from the person's chosen conflict calendar.
 *
 * `weeks` covers a whole term in one go — the point of a dedicated conflict
 * calendar is that you keep it current and the app follows, so re-syncing has
 * to be cheap to do and safe to repeat. Only rows a previous sync created are
 * touched: conflicts typed into the app directly have no source id and are
 * left alone, and an event deleted in Google disappears here next sync. */
export async function syncConflictCalendar(
  rangeStartIso: string,
  weeks: number,
  options: { userId?: string; wholeTerm?: boolean } = {},
): Promise<ConflictSyncResult> {
  // An AD can run this for somebody else so a dancer doesn't have to go and
  // do it themselves when their calendar changes. Anyone else only ever acts
  // on their own conflicts.
  const actor = await requireUser();
  const targetId = options.userId ?? actor.id;
  if (targetId !== actor.id) await requireAdmin();

  const me = await prisma.user.findUniqueOrThrow({
    where: { id: targetId },
    select: { conflictCalendarId: true, conflictCalendarName: true },
  });

  // Falling back to "primary" keeps the button working for anyone who hasn't
  // picked a calendar yet, which is how it behaved before this existed.
  const calendarId = me.conflictCalendarId ?? "primary";

  // A term covers the season the AD actually defined, and reaches backwards
  // as well as forwards — the week-count version could only ever look ahead.
  let rangeStart: Date;
  let rangeEnd: Date;
  if (options.wholeTerm) {
    const { range } = await activeRange();
    rangeStart = range.start;
    rangeEnd = range.end;
  } else {
    rangeStart = clampToSupportedRange(new Date(rangeStartIso));
    rangeEnd = addDays(rangeStart, weeks * 7);
  }

  const calendar = await getGoogleCalendarClientForUser(targetId);
  const { data } = await calendar.events.list({
    calendarId,
    timeMin: rangeStart.toISOString(),
    timeMax: rangeEnd.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500,
  });

  const events = (data.items ?? []).filter(
    (event) =>
      event.id &&
      event.status !== "cancelled" &&
      event.start?.dateTime &&
      event.end?.dateTime,
  );

  const existing = await prisma.conflict.findMany({
    where: {
      userId: targetId,
      sourceGoogleEventId: { not: null },
      startDateTime: { gte: rangeStart, lt: rangeEnd },
    },
    select: {
      id: true,
      sourceGoogleEventId: true,
      startDateTime: true,
      endDateTime: true,
      title: true,
    },
  });
  const existingByEventId = new Map(
    existing.map((row) => [row.sourceGoogleEventId!, row]),
  );

  let added = 0;
  let updated = 0;

  for (const event of events) {
    const start = new Date(event.start!.dateTime!);
    const end = new Date(event.end!.dateTime!);
    // The event's own title is the whole point — it's what the AD reads when
    // deciding whether a conflict is excused.
    const title = event.summary ?? null;
    const row = existingByEventId.get(event.id!);

    if (row) {
      existingByEventId.delete(event.id!);
      const unchanged =
        row.startDateTime.getTime() === start.getTime() &&
        row.endDateTime.getTime() === end.getTime() &&
        row.title === title;
      if (!unchanged) {
        await prisma.conflict.update({
          where: { id: row.id },
          data: {
            startDateTime: start,
            endDateTime: end,
            title,
            weekOf: startOfWeek(start),
          },
        });
        updated++;
      }
    } else {
      await prisma.conflict.create({
        data: {
          userId: targetId,
          weekOf: startOfWeek(start),
          startDateTime: start,
          endDateTime: end,
          title,
          sourceGoogleEventId: event.id,
        },
      });
      added++;
    }
  }

  const staleIds = Array.from(existingByEventId.values()).map((r) => r.id);
  if (staleIds.length > 0) {
    await prisma.conflict.deleteMany({ where: { id: { in: staleIds } } });
  }

  revalidatePath("/conflicts");
  revalidatePath("/admin/conflicts");
  return {
    added,
    updated,
    removed: staleIds.length,
    calendarName: me.conflictCalendarName ?? "your main calendar",
  };
}
