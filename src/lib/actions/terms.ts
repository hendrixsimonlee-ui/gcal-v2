"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { termDateToStored, validateTermDates } from "@/lib/terms";

function revalidateTermConsumers() {
  // Terms change what date range every one of these screens defaults to.
  revalidatePath("/admin/settings");
  revalidatePath("/admin/spaces");
  revalidatePath("/admin/schedule-builder");
  revalidatePath("/admin/attendance");
  revalidatePath("/conflicts");
}

export async function addTerm(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const startKey = String(formData.get("startDate") ?? "").trim();
  const endKey = String(formData.get("endDate") ?? "").trim();

  if (!name) throw new Error("Give the term a name, like “Fall 2026”.");
  const problem = validateTermDates(startKey, endKey);
  if (problem) throw new Error(problem);

  const existing = await prisma.term.count();

  await prisma.term.create({
    data: {
      name,
      startDate: termDateToStored(startKey),
      endDate: termDateToStored(endKey),
      // The first term defined is the one everything defaults to; there's
      // nothing else it could be.
      isCurrent: existing === 0,
    },
  });
  revalidateTermConsumers();
}

export async function updateTerm(termId: string, formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const startKey = String(formData.get("startDate") ?? "").trim();
  const endKey = String(formData.get("endDate") ?? "").trim();

  if (!name) throw new Error("Give the term a name, like “Fall 2026”.");
  const problem = validateTermDates(startKey, endKey);
  if (problem) throw new Error(problem);

  await prisma.term.update({
    where: { id: termId },
    data: {
      name,
      startDate: termDateToStored(startKey),
      endDate: termDateToStored(endKey),
    },
  });
  revalidateTermConsumers();
}

/** Exactly one term is current, so this clears the others in the same
 * transaction rather than leaving two flagged. */
export async function setCurrentTerm(termId: string) {
  await requireAdmin();
  await prisma.$transaction([
    prisma.term.updateMany({
      where: { isCurrent: true },
      data: { isCurrent: false },
    }),
    prisma.term.update({ where: { id: termId }, data: { isCurrent: true } }),
  ]);
  revalidateTermConsumers();
}

/** Deleting a term removes the label, never the practices or attendance that
 * fell inside it — those are keyed by date, not by term. */
export async function deleteTerm(termId: string) {
  await requireAdmin();
  const term = await prisma.term.findUnique({ where: { id: termId } });
  await prisma.term.delete({ where: { id: termId } });

  if (term?.isCurrent) {
    const next = await prisma.term.findFirst({ orderBy: { startDate: "desc" } });
    if (next) {
      await prisma.term.update({
        where: { id: next.id },
        data: { isCurrent: true },
      });
    }
  }
  revalidateTermConsumers();
}
