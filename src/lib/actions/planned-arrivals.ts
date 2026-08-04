"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireChoreographerOrAdmin } from "@/lib/authz";
import { syncPracticeToTeamCalendar } from "@/lib/team-calendar";

export interface ArrivalSuggestion {
  userId: string;
  name: string;
  /** The conflict that clips the start of the practice. */
  conflictTitle: string | null;
  conflictEndsAt: Date;
}

/** Cast members whose conflict ends part-way into the practice.
 *
 * A class that runs to 6:15 against a 6:00 call isn't an absence, it's a late
 * arrival — but nothing in the data says so until somebody records it. This
 * spots the pattern and lets the AD accept it in one tap instead of typing
 * the time out. */
export async function suggestPlannedArrivals(
  practiceId: string,
): Promise<ArrivalSuggestion[]> {
  await requireAdmin();
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    include: {
      dance: { include: { memberships: { include: { user: true } } } },
      plannedArrivals: { select: { userId: true } },
    },
  });

  const castUserIds = practice.dance.memberships.map((m) => m.userId);
  const alreadyPlanned = new Set(practice.plannedArrivals.map((p) => p.userId));

  const conflicts = await prisma.conflict.findMany({
    where: {
      userId: { in: castUserIds },
      startDateTime: { lt: practice.endDateTime },
      endDateTime: { gt: practice.startDateTime },
    },
  });

  const suggestions = new Map<string, ArrivalSuggestion>();
  for (const conflict of conflicts) {
    if (alreadyPlanned.has(conflict.userId)) continue;
    // Only a conflict that clips the *front* of the practice and clears
    // before the end. One that runs past the end is a real absence.
    if (conflict.endDateTime >= practice.endDateTime) continue;
    if (conflict.endDateTime <= practice.startDateTime) continue;

    const member = practice.dance.memberships.find(
      (m) => m.userId === conflict.userId,
    );
    if (!member) continue;

    // If someone has two, the later end time is when they can actually get
    // there.
    const existing = suggestions.get(conflict.userId);
    if (existing && existing.conflictEndsAt >= conflict.endDateTime) continue;

    suggestions.set(conflict.userId, {
      userId: conflict.userId,
      name: member.user.name ?? member.user.email,
      conflictTitle: conflict.title,
      conflictEndsAt: conflict.endDateTime,
    });
  }

  return Array.from(suggestions.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export async function setPlannedArrival(
  practiceId: string,
  userId: string,
  arriveAtIso: string,
  reason?: string | null,
) {
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { danceId: true, startDateTime: true, endDateTime: true },
  });
  await requireChoreographerOrAdmin(practice.danceId);

  const arriveAt = new Date(arriveAtIso);
  if (Number.isNaN(arriveAt.getTime())) throw new Error("Invalid arrival time");
  if (arriveAt >= practice.endDateTime) {
    throw new Error("That's after the practice ends — record it as an absence instead");
  }

  await prisma.plannedArrival.upsert({
    where: { practiceId_userId: { practiceId, userId } },
    update: { arriveAt, reason: reason ?? null },
    create: { practiceId, userId, arriveAt, reason: reason ?? null },
  });

  // The team calendar lists who's coming late, so it has to hear about this.
  await syncPracticeToTeamCalendar(practiceId);

  revalidatePath("/admin/schedule-builder");
  revalidatePath(`/attendance/${practiceId}`);
  revalidatePath("/schedule");
}

export async function removePlannedArrival(practiceId: string, userId: string) {
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { danceId: true },
  });
  await requireChoreographerOrAdmin(practice.danceId);

  await prisma.plannedArrival.deleteMany({ where: { practiceId, userId } });
  await syncPracticeToTeamCalendar(practiceId);

  revalidatePath("/admin/schedule-builder");
  revalidatePath(`/attendance/${practiceId}`);
  revalidatePath("/schedule");
}
