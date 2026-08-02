"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

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

export async function deleteAvailability(availabilityId: string) {
  await requireAdmin();
  await prisma.spaceAvailability.delete({ where: { id: availabilityId } });
  revalidatePath("/admin/spaces");
}
