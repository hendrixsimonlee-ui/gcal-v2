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

/** Fixes a name or email in place.
 *
 * Names arrive from Google on first sign-in and are often not what the team
 * calls someone; emails get typed wrong when the AD pre-adds the roster.
 * Neither was editable, so the only fix was to delete the person and add them
 * again — which took their conflicts and attendance with them. */
export async function updateRosterMember(userId: string, formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) throw new Error("Email is required");

  const clash = await prisma.user.findFirst({
    where: { email, id: { not: userId } },
    select: { name: true, email: true },
  });
  if (clash) {
    throw new Error(
      `${clash.name ?? clash.email} already uses that email. Merge them by hand rather than duplicating.`,
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: { name: name || null, email },
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
