"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { startOfWeek, addDays } from "@/lib/dates";
import { getGoogleCalendarClientForUser } from "@/lib/google-calendar";

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
  categoryId: string | null;
  note: string | null;
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
        categoryId: input.categoryId,
        note: input.note,
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

export async function updateConflictCategory(
  conflictId: string,
  formData: FormData,
) {
  const session = await auth();
  const conflict = await prisma.conflict.findUniqueOrThrow({
    where: { id: conflictId },
  });
  if (conflict.userId !== session!.user.id && !session!.user.isAdmin) {
    throw new Error("Not authorized to edit this conflict");
  }
  const categoryId = String(formData.get("categoryId") ?? "") || null;
  await prisma.conflict.update({
    where: { id: conflictId },
    data: { categoryId },
  });
  revalidatePath("/conflicts");
  revalidatePath("/admin/conflicts");
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

export async function importGoogleCalendarWeek(weekStartIso: string) {
  const session = await auth();
  const userId = session!.user.id;

  const weekStart = new Date(weekStartIso);
  const weekEnd = addDays(weekStart, 7);

  const calendar = await getGoogleCalendarClientForUser(userId);
  const { data } = await calendar.events.list({
    calendarId: "primary",
    timeMin: weekStart.toISOString(),
    timeMax: weekEnd.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });

  const events = (data.items ?? []).filter(
    (event) => event.id && event.start?.dateTime && event.end?.dateTime,
  );

  for (const event of events) {
    const start = new Date(event.start!.dateTime!);
    const end = new Date(event.end!.dateTime!);
    const existing = await prisma.conflict.findFirst({
      where: { userId, sourceGoogleEventId: event.id },
      select: { id: true },
    });

    if (existing) {
      await prisma.conflict.update({
        where: { id: existing.id },
        data: {
          startDateTime: start,
          endDateTime: end,
          note: event.summary ?? null,
          weekOf: startOfWeek(start),
        },
      });
    } else {
      await prisma.conflict.create({
        data: {
          userId,
          weekOf: startOfWeek(start),
          startDateTime: start,
          endDateTime: end,
          note: event.summary ?? null,
          sourceGoogleEventId: event.id,
        },
      });
    }
  }

  revalidatePath("/conflicts");
}
