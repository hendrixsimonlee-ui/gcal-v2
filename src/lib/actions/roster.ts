"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";

export async function addRosterMember(formData: FormData) {
  await requireAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  if (!email) throw new Error("Email is required");

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: name || null },
  });

  revalidatePath("/admin/roster");
}

export async function toggleAdmin(userId: string, isAdmin: boolean) {
  await requireAdmin();
  await prisma.user.update({ where: { id: userId }, data: { isAdmin } });
  revalidatePath("/admin/roster");
}

export async function removeRosterMember(userId: string) {
  await requireAdmin();
  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/admin/roster");
}
