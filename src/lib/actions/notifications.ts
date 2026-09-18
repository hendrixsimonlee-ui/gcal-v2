"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUser } from "@/lib/authz";
import { addDays, startOfWeek } from "@/lib/dates";
import { parseAppDateTime } from "@/lib/timezone";

export async function markAllNotificationsRead() {
  const user = await requireUser();
  await prisma.notification.updateMany({
    where: { userId: user.id, read: false },
    data: { read: true },
  });
  revalidatePath("/notifications");
  revalidatePath("/schedule");
}

export async function markNotificationRead(notificationId: string) {
  const user = await requireUser();
  await prisma.notification.updateMany({
    where: { id: notificationId, userId: user.id },
    data: { read: true },
  });
  revalidatePath("/notifications");
}

/** When the weekly conflicts nudge goes out.
 *
 * The one message in the app that arrives without the AD pressing anything,
 * so they choose the moment — and it stays off until they do. */
export async function getConflictNudgeSchedule(): Promise<{
  enabled: boolean;
  weekday: number;
  hour: number;
  minute: number;
  /** Mondays, as yyyy-mm-dd, of the weeks the AD has switched off. */
  skippedWeeks: string[];
}> {
  await requireAdmin();
  const settings = await prisma.appSettings.findUnique({
    where: { id: "singleton" },
    select: {
      conflictNudgeEnabled: true,
      conflictNudgeWeekday: true,
      conflictNudgeHour: true,
      conflictNudgeMinute: true,
    },
  });
  // Only weeks still ahead. A break that has already passed is clutter, and
  // the rows are harmless to leave in the table.
  const skips = await prisma.conflictReminderSkip.findMany({
    where: { weekOf: { gte: addDays(startOfWeek(new Date()), -7) } },
    orderBy: { weekOf: "asc" },
    select: { weekOf: true },
  });

  return {
    // These fall back to the schema defaults rather than the old ones. A
    // mismatch here is invisible until the settings row is missing, at which
    // point the screen would show a schedule the cron job isn't using.
    enabled: settings?.conflictNudgeEnabled ?? true,
    weekday: settings?.conflictNudgeWeekday ?? 4,
    hour: settings?.conflictNudgeHour ?? 12,
    minute: settings?.conflictNudgeMinute ?? 0,
    skippedWeeks: skips.map((s) => s.weekOf.toISOString().slice(0, 10)),
  };
}

/** Switch the reminders off for one week, such as a break.
 *
 * The AD picks any date; it is stored as the Monday of that week, so picking
 * the Wednesday of winter break does what they meant rather than nothing. */
export async function skipConflictReminderWeek(formData: FormData) {
  await requireAdmin();

  const dateKey = String(formData.get("weekOf") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;

  // Eastern, like every other date in the app. Parsing the bare key as UTC
  // would land on the previous evening and could pick the wrong Monday.
  const weekOf = startOfWeek(parseAppDateTime(dateKey));

  await prisma.conflictReminderSkip.upsert({
    where: { weekOf },
    update: {},
    create: { weekOf },
  });
  revalidatePath("/admin/settings");
}

export async function unskipConflictReminderWeek(formData: FormData) {
  await requireAdmin();

  const dateKey = String(formData.get("weekOf") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;

  await prisma.conflictReminderSkip.deleteMany({
    where: { weekOf: startOfWeek(parseAppDateTime(dateKey)) },
  });
  revalidatePath("/admin/settings");
}

export async function setConflictNudgeSchedule(formData: FormData) {
  await requireAdmin();

  const enabled = formData.get("conflictNudgeEnabled") === "on";
  const weekday = Number(formData.get("conflictNudgeWeekday"));
  // One <input type="time"> rather than two number boxes: it's a time, and
  // the phone keyboard for it is the right one.
  const [rawHour, rawMinute] = String(formData.get("conflictNudgeTime") ?? "")
    .split(":")
    .map(Number);

  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    throw new Error("Pick a day of the week");
  }
  if (
    !Number.isInteger(rawHour) ||
    !Number.isInteger(rawMinute) ||
    rawHour < 0 ||
    rawHour > 23 ||
    rawMinute < 0 ||
    rawMinute > 59
  ) {
    throw new Error("Pick a time of day");
  }

  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {
      conflictNudgeEnabled: enabled,
      conflictNudgeWeekday: weekday,
      conflictNudgeHour: rawHour,
      conflictNudgeMinute: rawMinute,
    },
    create: {
      id: "singleton",
      conflictNudgeEnabled: enabled,
      conflictNudgeWeekday: weekday,
      conflictNudgeHour: rawHour,
      conflictNudgeMinute: rawMinute,
    },
  });

  revalidatePath("/admin/settings");
}
