"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUser } from "@/lib/authz";

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
  return {
    enabled: settings?.conflictNudgeEnabled ?? false,
    weekday: settings?.conflictNudgeWeekday ?? 4,
    hour: settings?.conflictNudgeHour ?? 18,
    minute: settings?.conflictNudgeMinute ?? 0,
  };
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
