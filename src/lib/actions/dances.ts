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
