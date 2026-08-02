"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireChoreographerOrAdmin } from "@/lib/authz";

const SETTINGS_ID = "singleton";

export async function getAttendanceSettings() {
  const existing = await prisma.appSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  if (existing) return existing;

  // First read creates the row with schema defaults, so the AD always has
  // something concrete to edit on the Settings screen.
  return prisma.appSettings.create({ data: { id: SETTINGS_ID } });
}

export async function updateAttendanceSettings(formData: FormData) {
  await requireAdmin();
  const threshold = Number(formData.get("chronicAbsenceThreshold"));
  const window = Number(formData.get("chronicAbsenceWindow"));

  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error("Threshold must be a whole number of 1 or more");
  }
  if (!Number.isInteger(window) || window < 1) {
    throw new Error("Window must be a whole number of 1 or more");
  }
  if (threshold > window) {
    throw new Error(
      "Threshold can't be larger than the window — nobody could ever be flagged",
    );
  }

  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { chronicAbsenceThreshold: threshold, chronicAbsenceWindow: window },
    create: {
      id: SETTINGS_ID,
      chronicAbsenceThreshold: threshold,
      chronicAbsenceWindow: window,
    },
  });
  revalidatePath("/admin/settings");
  revalidatePath("/admin/attendance");
}

/** Bulk check-off for one practice. `presentUserIds` is everyone ticked as
 * having shown up; every other cast member is recorded as absent, so a saved
 * practice always has a complete record rather than a partial one. */
export async function saveAttendance(
  practiceId: string,
  presentUserIds: string[],
) {
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    include: { dance: { include: { memberships: true } } },
  });
  const marker = await requireChoreographerOrAdmin(practice.danceId);

  const present = new Set(presentUserIds);
  const castUserIds = practice.dance.memberships.map((m) => m.userId);

  await prisma.$transaction(
    castUserIds.map((userId) =>
      prisma.attendance.upsert({
        where: { practiceId_userId: { practiceId, userId } },
        update: {
          attended: present.has(userId),
          markedById: marker.id,
          markedAt: new Date(),
        },
        create: {
          practiceId,
          userId,
          attended: present.has(userId),
          markedById: marker.id,
        },
      }),
    ),
  );

  revalidatePath("/attendance");
  revalidatePath(`/attendance/${practiceId}`);
  revalidatePath("/my-attendance");
  revalidatePath("/admin/attendance");
}
