"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function addCategory(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const isExcused = formData.get("isExcused") === "on";
  if (!name) throw new Error("Category name is required");

  await prisma.conflictCategory.create({ data: { name, isExcused } });
  revalidatePath("/admin/categories");
}

export async function deleteCategory(categoryId: string) {
  await requireAdmin();
  await prisma.conflictCategory.delete({ where: { id: categoryId } });
  revalidatePath("/admin/categories");
}
