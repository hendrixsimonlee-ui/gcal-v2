"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { startOfWeek } from "@/lib/dates";
import { ANY_SPACE } from "@/lib/constants";
import {
  notifyPracticeChanged,
  notifyPracticeConfirmed,
  notifySchedulePublished,
} from "@/lib/notify";
import {
  removePracticeFromTeamCalendar,
  resyncDanceCalendar,
  syncPracticeToTeamCalendar,
} from "@/lib/team-calendar";
import { getHistoricalAbsenceRates } from "@/lib/attendance-data";
import { getAttendanceSettings } from "@/lib/actions/attendance";
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

  const [memberships, spaceRows, allPractices] = await Promise.all([
    prisma.danceMembership.findMany({
      where: { danceId },
      include: { user: true },
    }),
    prisma.space.findMany({
      where: spaceId === ANY_SPACE ? {} : { id: spaceId },
      include: { availabilities: true },
      orderBy: { name: "asc" },
    }),
    // Both PROPOSED and CONFIRMED: the AD drafts a whole term and confirms
    // it in one go, so a draft has to hold its room and count against its
    // cast in the meantime, or building the schedule would silently
    // double-book.
    prisma.practice.findMany({
      // Archived pieces are out of the scheduling picture entirely — their
      // practices shouldn't hold rooms or count as clashes for the cast.
      where: { dance: { archivedAt: null } },
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

  const settings = await getAttendanceSettings();
  const historicalAbsenceRates = settings.useHistoricalWeighting
    ? await getHistoricalAbsenceRates(castUserIds)
    : undefined;

  const [conflicts, unavailabilities, weeklyExcuses] = await Promise.all([
    prisma.conflict.findMany({ where: { userId: { in: castUserIds } } }),
    prisma.unavailability.findMany({
      where: { userId: { in: castUserIds } },
    }),
    prisma.choreographerWeeklyExcuse.findMany({ where: { danceId } }),
  ]);

  const existingPracticesForCast = allPractices.map((p) => ({
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

  const spaces = spaceRows.map((space) => ({
    spaceId: space.id,
    spaceName: space.name,
    recurringWindows: space.availabilities
      .filter((a) => a.dayOfWeek !== null && a.startTime && a.endTime)
      .map((a) => ({
        dayOfWeek: a.dayOfWeek!,
        startTime: a.startTime!,
        endTime: a.endTime!,
      })),
    dateOverrides: space.availabilities
      .filter((a) => a.date !== null)
      .map((a) => ({
        date: a.date!,
        isAvailable: a.isAvailable,
        startTime: a.startTime,
        endTime: a.endTime,
      })),
    existingPractices: allPractices
      .filter((p) => p.spaceId === space.id)
      .map((p) => ({
        id: p.id,
        danceId: p.danceId,
        startDateTime: p.startDateTime,
        endDateTime: p.endDateTime,
        castUserIds: [] as string[],
      })),
  }));

  return generateCandidateSlots({
    castMembers,
    conflicts: conflicts.map((c) => ({
      id: c.id,
      userId: c.userId,
      startDateTime: c.startDateTime,
      endDateTime: c.endDateTime,
      // An unreviewed conflict is weighted as unexcused: it's a real
      // conflict either way, and the heavier cost nudges the AD to review it.
      isExcused: c.status === "EXCUSED",
    })),
    unavailabilities,
    spaces,
    existingPracticesForCast,
    choreographerExcusedByWeek,
    ignoredUserIds: new Set(ignoredUserIds),
    historicalAbsenceRates,
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
    title: string | null;
    status: "NOT_REVIEWED" | "EXCUSED" | "UNEXCUSED";
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
        title: c.title,
        status: c.status,
      })),
  }));
}

export interface WeekTrackerRow {
  danceId: string;
  danceName: string;
  defaultDurationMinutes: number;
  weekOff: boolean;
  practices: {
    id: string;
    startDateTime: Date;
    endDateTime: Date;
    spaceName: string | null;
    status: "PROPOSED" | "CONFIRMED";
  }[];
}

/** Every active dance's state for one week: booked, still to do, or
 * deliberately off. This is the AD's checklist — without it, "have I done
 * everything?" means scanning the whole calendar grid dance by dance. */
export async function getWeekTracker(
  weekOfIso: string,
): Promise<WeekTrackerRow[]> {
  await requireAdmin();
  const weekOf = startOfWeek(new Date(weekOfIso));
  const weekEnd = new Date(weekOf.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [dances, practices, weeksOff] = await Promise.all([
    prisma.dance.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, defaultDurationMinutes: true },
    }),
    prisma.practice.findMany({
      where: {
        dance: { archivedAt: null },
        startDateTime: { gte: weekOf, lt: weekEnd },
      },
      orderBy: { startDateTime: "asc" },
      include: { space: { select: { name: true } } },
    }),
    prisma.danceWeekOff.findMany({ where: { weekOf } }),
  ]);

  const offIds = new Set(weeksOff.map((w) => w.danceId));

  return dances.map((dance) => ({
    danceId: dance.id,
    danceName: dance.name,
    defaultDurationMinutes: dance.defaultDurationMinutes,
    weekOff: offIds.has(dance.id),
    practices: practices
      .filter((p) => p.danceId === dance.id)
      .map((p) => ({
        id: p.id,
        startDateTime: p.startDateTime,
        endDateTime: p.endDateTime,
        spaceName: p.space?.name ?? null,
        status: p.status,
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
  const start = new Date(startDateTime);
  const end = new Date(endDateTime);

  // Dragging a slot out on the grid with "Any space" selected still has to
  // land in a real room, so pick the first one that's actually free then.
  const resolvedSpaceId =
    spaceId === ANY_SPACE ? await firstFreeSpace(start, end) : spaceId;

  if (!resolvedSpaceId) {
    throw new Error("Every space is already booked for that time");
  }

  await prisma.practice.create({
    data: {
      danceId,
      spaceId: resolvedSpaceId,
      startDateTime: start,
      endDateTime: end,
      status: "PROPOSED",
    },
  });
  revalidatePath("/admin/schedule-builder");
}

async function firstFreeSpace(start: Date, end: Date): Promise<string | null> {
  const [spaces, clashes] = await Promise.all([
    prisma.space.findMany({ orderBy: { name: "asc" }, select: { id: true } }),
    prisma.practice.findMany({
      where: {
        startDateTime: { lt: end },
        endDateTime: { gt: start },
      },
      select: { spaceId: true },
    }),
  ]);
  const taken = new Set(clashes.map((c) => c.spaceId));
  return spaces.find((s) => !taken.has(s.id))?.id ?? null;
}

export async function updatePracticeTime(
  practiceId: string,
  startDateTime: string,
  endDateTime: string,
) {
  await requireAdmin();
  const before = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { status: true, startDateTime: true },
  });

  const practice = await prisma.practice.update({
    where: { id: practiceId },
    data: {
      startDateTime: new Date(startDateTime),
      endDateTime: new Date(endDateTime),
    },
  });

  // Moving a published practice is a change the team needs to hear about,
  // and the shared calendar has to follow it without anyone pressing a
  // button. Dragging a draft around is just the AD thinking out loud.
  if (before.status === "CONFIRMED") {
    await syncPracticeToTeamCalendar(practiceId);
    if (before.startDateTime.getTime() !== practice.startDateTime.getTime()) {
      await notifyPracticeChanged(practiceId, "moved");
    }
  }

  revalidatePath("/admin/schedule-builder");
  revalidatePath("/schedule");
}

export async function confirmPractice(practiceId: string) {
  await requireAdmin();
  const existing = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { status: true },
  });

  await prisma.practice.update({
    where: { id: practiceId },
    data: { status: "CONFIRMED" },
  });

  // Only announce the transition, so re-confirming an already-confirmed
  // practice doesn't spam the cast a second time.
  if (existing.status !== "CONFIRMED") {
    await notifyPracticeConfirmed(practiceId);
  }
  await syncPracticeToTeamCalendar(practiceId);

  revalidatePath("/admin/schedule-builder");
  revalidatePath("/schedule");
  revalidatePath("/notifications");
}

/** Publishes the whole draft schedule in one go — the normal way to finish,
 * since the AD lays out a term's worth of practices before telling anyone.
 * Everyone affected gets a single summary rather than one message per
 * practice. Returns what happened so the UI can report it. */
export async function confirmAllDrafts(): Promise<{
  confirmed: number;
  peopleNotified: number;
}> {
  await requireAdmin();

  const drafts = await prisma.practice.findMany({
    where: { status: "PROPOSED" },
    select: { id: true, dance: { select: { memberships: { select: { userId: true } } } } },
  });
  if (drafts.length === 0) return { confirmed: 0, peopleNotified: 0 };

  const ids = drafts.map((d) => d.id);
  await prisma.practice.updateMany({
    where: { id: { in: ids } },
    data: { status: "CONFIRMED" },
  });

  await notifySchedulePublished(ids);
  // The shared team calendar fills itself in as part of publishing.
  for (const id of ids) {
    await syncPracticeToTeamCalendar(id);
  }

  const people = new Set(
    drafts.flatMap((d) => d.dance.memberships.map((m) => m.userId)),
  );

  revalidatePath("/admin/schedule-builder");
  revalidatePath("/schedule");
  revalidatePath("/notifications");
  return { confirmed: ids.length, peopleNotified: people.size };
}

export async function deletePractice(practiceId: string) {
  await requireAdmin();
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { danceId: true, status: true },
  });

  if (practice.status === "CONFIRMED") {
    await notifyPracticeChanged(practiceId, "cancelled");
  }
  await removePracticeFromTeamCalendar(practiceId);
  await prisma.practice.delete({ where: { id: practiceId } });

  // Everything after it in this dance just moved up a number, so their
  // calendar titles are now wrong.
  await resyncDanceCalendar(practice.danceId);

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
