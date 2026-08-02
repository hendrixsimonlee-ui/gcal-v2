"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { startOfWeek } from "@/lib/dates";
import {
  generateCandidateSlots,
  type CandidateSlot,
  type CastMember,
} from "@/lib/scheduling";

const SEARCH_WEEKS = 4;
const SLOT_INCREMENT_MINUTES = 30;

export async function getCandidateSlots(
  danceId: string,
  spaceId: string,
  durationMinutes: number,
  ignoredUserIds: string[],
): Promise<CandidateSlot[]> {
  await requireAdmin();

  const [memberships, space, allConfirmedPractices] = await Promise.all([
    prisma.danceMembership.findMany({
      where: { danceId },
      include: { user: true },
    }),
    prisma.space.findUniqueOrThrow({
      where: { id: spaceId },
      include: { availabilities: true },
    }),
    prisma.practice.findMany({
      where: { status: "CONFIRMED" },
      include: {
        dance: { include: { memberships: { select: { userId: true } } } },
      },
    }),
  ]);

  const castMembers: CastMember[] = memberships.map((m) => ({
    userId: m.userId,
    name: m.user.name ?? m.user.email,
    role: m.role,
  }));
  const castUserIds = castMembers.map((m) => m.userId);

  const [conflicts, unavailabilities, weeklyExcuses] = await Promise.all([
    prisma.conflict.findMany({
      where: { userId: { in: castUserIds } },
      include: { category: true },
    }),
    prisma.unavailability.findMany({
      where: { userId: { in: castUserIds } },
    }),
    prisma.choreographerWeeklyExcuse.findMany({ where: { danceId } }),
  ]);

  const existingPracticesAtSpace = allConfirmedPractices
    .filter((p) => p.spaceId === spaceId)
    .map((p) => ({
      id: p.id,
      danceId: p.danceId,
      startDateTime: p.startDateTime,
      endDateTime: p.endDateTime,
      castUserIds: [] as string[],
    }));

  const existingPracticesForCast = allConfirmedPractices.map((p) => ({
    id: p.id,
    danceId: p.danceId,
    startDateTime: p.startDateTime,
    endDateTime: p.endDateTime,
    castUserIds: p.dance.memberships.map((m) => m.userId),
  }));

  // A choreographer's weekly excuse only applies to the specific week it
  // names, so this is keyed by week rather than a flat set of user ids.
  const choreographerExcusedByWeek = new Map<string, Set<string>>();
  for (const excuse of weeklyExcuses) {
    const key = excuse.weekOf.toISOString();
    if (!choreographerExcusedByWeek.has(key)) {
      choreographerExcusedByWeek.set(key, new Set());
    }
    choreographerExcusedByWeek.get(key)!.add(excuse.userId);
  }

  const recurringWindows = space.availabilities
    .filter((a) => a.dayOfWeek !== null && a.startTime && a.endTime)
    .map((a) => ({
      dayOfWeek: a.dayOfWeek!,
      startTime: a.startTime!,
      endTime: a.endTime!,
    }));

  const dateOverrides = space.availabilities
    .filter((a) => a.date !== null)
    .map((a) => ({ date: a.date!, isAvailable: a.isAvailable }));

  return generateCandidateSlots({
    castMembers,
    conflicts: conflicts.map((c) => ({
      id: c.id,
      userId: c.userId,
      startDateTime: c.startDateTime,
      endDateTime: c.endDateTime,
      isExcused: c.category?.isExcused ?? false,
    })),
    unavailabilities,
    existingPracticesAtSpace,
    existingPracticesForCast,
    recurringWindows,
    dateOverrides,
    choreographerExcusedByWeek,
    ignoredUserIds: new Set(ignoredUserIds),
    danceId,
    durationMinutes,
    searchWeeks: SEARCH_WEEKS,
    slotIncrementMinutes: SLOT_INCREMENT_MINUTES,
  });
}

export interface SidebarCastMember {
  userId: string;
  name: string;
  role: "DANCER" | "CHOREOGRAPHER";
  excusedThisWeek: boolean;
  conflicts: {
    id: string;
    startDateTime: Date;
    endDateTime: Date;
    categoryName: string | null;
    isExcused: boolean;
  }[];
}

/** Cast + their conflicts in the visible calendar range, and each
 * choreographer's weekly-excuse status for that week — feeds the schedule
 * builder's side panel. */
export async function getSchedulingSidebarData(
  danceId: string,
  weekOfIso: string,
  rangeStartIso: string,
  rangeEndIso: string,
): Promise<SidebarCastMember[]> {
  await requireAdmin();
  const weekOf = startOfWeek(new Date(weekOfIso));
  const rangeStart = new Date(rangeStartIso);
  const rangeEnd = new Date(rangeEndIso);

  const [memberships, conflicts, excuses] = await Promise.all([
    prisma.danceMembership.findMany({
      where: { danceId },
      include: { user: true },
      orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
    }),
    prisma.conflict.findMany({
      where: {
        user: { memberships: { some: { danceId } } },
        startDateTime: { lt: rangeEnd },
        endDateTime: { gt: rangeStart },
      },
      include: { category: true },
    }),
    prisma.choreographerWeeklyExcuse.findMany({ where: { danceId, weekOf } }),
  ]);

  const excusedIds = new Set(excuses.map((e) => e.userId));

  return memberships.map((m) => ({
    userId: m.userId,
    name: m.user.name ?? m.user.email,
    role: m.role,
    excusedThisWeek: excusedIds.has(m.userId),
    conflicts: conflicts
      .filter((c) => c.userId === m.userId)
      .map((c) => ({
        id: c.id,
        startDateTime: c.startDateTime,
        endDateTime: c.endDateTime,
        categoryName: c.category?.name ?? null,
        isExcused: c.category?.isExcused ?? false,
      })),
  }));
}

export async function createDraftPractice(
  danceId: string,
  spaceId: string,
  startDateTime: string,
  endDateTime: string,
) {
  await requireAdmin();
  await prisma.practice.create({
    data: {
      danceId,
      spaceId,
      startDateTime: new Date(startDateTime),
      endDateTime: new Date(endDateTime),
      status: "PROPOSED",
    },
  });
  revalidatePath("/admin/schedule-builder");
}

export async function updatePracticeTime(
  practiceId: string,
  startDateTime: string,
  endDateTime: string,
) {
  await requireAdmin();
  await prisma.practice.update({
    where: { id: practiceId },
    data: {
      startDateTime: new Date(startDateTime),
      endDateTime: new Date(endDateTime),
    },
  });
  revalidatePath("/admin/schedule-builder");
  revalidatePath("/schedule");
}

export async function confirmPractice(practiceId: string) {
  await requireAdmin();
  await prisma.practice.update({
    where: { id: practiceId },
    data: { status: "CONFIRMED" },
  });
  revalidatePath("/admin/schedule-builder");
  revalidatePath("/schedule");
}

export async function deletePractice(practiceId: string) {
  await requireAdmin();
  await prisma.practice.delete({ where: { id: practiceId } });
  revalidatePath("/admin/schedule-builder");
  revalidatePath("/schedule");
}

export async function setChoreographerWeeklyExcuse(
  danceId: string,
  userId: string,
  weekOfIso: string,
  excused: boolean,
) {
  await requireAdmin();
  const weekOf = startOfWeek(new Date(weekOfIso));

  if (excused) {
    await prisma.choreographerWeeklyExcuse.upsert({
      where: { danceId_userId_weekOf: { danceId, userId, weekOf } },
      update: {},
      create: { danceId, userId, weekOf },
    });
  } else {
    await prisma.choreographerWeeklyExcuse.deleteMany({
      where: { danceId, userId, weekOf },
    });
  }
  revalidatePath("/admin/schedule-builder");
}
