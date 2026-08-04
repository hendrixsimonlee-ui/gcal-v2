"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";

export async function addDance(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const season = String(formData.get("season") ?? "").trim();
  if (!name) throw new Error("Dance name is required");

  await prisma.dance.create({ data: { name, season: season || null } });
  revalidatePath("/admin/dances");
}

/** Archiving keeps every practice and attendance record but takes the dance
 * off scheduling and everyone's personal screens — for a piece that ran
 * Aug–Oct and is finished. Reversible; nothing is deleted. */
export async function setDanceArchived(danceId: string, archived: boolean) {
  await requireAdmin();
  await prisma.dance.update({
    where: { id: danceId },
    data: { archivedAt: archived ? new Date() : null },
  });
  revalidatePath("/admin/dances");
  revalidatePath("/admin/schedule-builder");
  revalidatePath("/admin/attendance");
  revalidatePath("/schedule");
  revalidatePath("/my-attendance");
  revalidatePath("/attendance");
}

/** The usual practice length for a piece. The builder pre-fills from this, and
 * the tracker shows it for dances that aren't booked yet. */
export async function setDanceDefaultDuration(
  danceId: string,
  formData: FormData,
) {
  await requireAdmin();
  const minutes = Number(formData.get("defaultDurationMinutes"));
  if (!Number.isFinite(minutes) || minutes < 15 || minutes > 480) {
    throw new Error("Practice length must be between 15 and 480 minutes");
  }
  await prisma.dance.update({
    where: { id: danceId },
    data: { defaultDurationMinutes: Math.round(minutes) },
  });
  revalidatePath("/admin/dances");
  revalidatePath("/admin/schedule-builder");
}

/** "This piece isn't rehearsing this week." Distinguishes a deliberate week
 * off from a week the AD simply hasn't got to yet, so the tracker can show a
 * genuine done/not-done state. */
export async function setDanceWeekOff(
  danceId: string,
  weekOfIso: string,
  off: boolean,
) {
  await requireAdmin();
  const weekOf = new Date(weekOfIso);
  if (Number.isNaN(weekOf.getTime())) throw new Error("Invalid week");

  if (off) {
    await prisma.danceWeekOff.upsert({
      where: { danceId_weekOf: { danceId, weekOf } },
      update: {},
      create: { danceId, weekOf },
    });
  } else {
    await prisma.danceWeekOff.deleteMany({ where: { danceId, weekOf } });
  }
  revalidatePath("/admin/schedule-builder");
}

export async function deleteDance(danceId: string) {
  await requireAdmin();
  await prisma.dance.delete({ where: { id: danceId } });
  revalidatePath("/admin/dances");
}

export async function addMembership(danceId: string, formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!userId || (role !== "DANCER" && role !== "CHOREOGRAPHER")) {
    throw new Error("Invalid membership");
  }

  await prisma.danceMembership.upsert({
    where: { userId_danceId_role: { userId, danceId, role } },
    update: {},
    create: { userId, danceId, role },
  });
  revalidatePath("/admin/dances");
}

export async function removeMembership(membershipId: string) {
  await requireAdmin();
  await prisma.danceMembership.delete({ where: { id: membershipId } });
  revalidatePath("/admin/dances");
}
