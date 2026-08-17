"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { startOfWeek } from "@/lib/dates";
import { APP_TIME_ZONE } from "@/lib/timezone";
import { ANY_SPACE } from "@/lib/constants";
import {
  announcePracticeChanges,
  notifyPracticeChanged,
  notifyPracticeConfirmed,
  notifySchedulePublished,
  notifyWeekCancelled,
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

/** "Thursday, Aug 6 at 7:00 PM" — the phrasing a change note reads best in. */
const changeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "long",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

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
      include: { bookings: true },
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
    prisma.weeklyExclusion.findMany({ where: { danceId } }),
  ]);

  const existingPracticesForCast = allPractices.map((p) => ({
    id: p.id,
    danceId: p.danceId,
    startDateTime: p.startDateTime,
    endDateTime: p.endDateTime,
    castUserIds: p.dance.memberships.map((m) => m.userId),
  }));

  // An exclusion only applies to the week it names, so this is keyed by week
  // rather than a flat set of user ids. Excluding someone drops them out of
  // the hard mandatory-attendee check AND out of the soft scoring, which is
  // what "leave them out of this week entirely" has to mean.
  const choreographerExcusedByWeek = new Map<string, Set<string>>();
  for (const excuse of weeklyExcuses) {
    const key = excuse.weekOf.toISOString();
    if (!choreographerExcusedByWeek.has(key)) {
      choreographerExcusedByWeek.set(key, new Set());
    }
    choreographerExcusedByWeek.get(key)!.add(excuse.userId);
  }
  const excludedUserIds = new Set(weeklyExcuses.map((e) => e.userId));

  const spaces = spaceRows.map((space) => ({
    spaceId: space.id,
    spaceName: space.name,
    bookings: space.bookings.map((b) => ({
      date: b.date,
      startTime: b.startTime,
      endTime: b.endTime,
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
    ignoredUserIds: new Set([...ignoredUserIds, ...excludedUserIds]),
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
  /** Left out of this week's scheduling, with the reason on record. */
  excludedThisWeek: boolean;
  exclusionReason: string | null;
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
    prisma.weeklyExclusion.findMany({ where: { danceId, weekOf } }),
  ]);

  const excusedById = new Map(excuses.map((e) => [e.userId, e]));

  return memberships.map((m) => ({
    userId: m.userId,
    name: m.user.name ?? m.user.email,
    role: m.role,
    excludedThisWeek: excusedById.has(m.userId),
    exclusionReason: excusedById.get(m.userId)?.reason ?? null,
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

/** What a dance's week is, in one word the AD picks from a dropdown.
 *
 * NOT_PRACTISING is set by hand. DRAFT and PUBLISHED are what the practices
 * say, so the dropdown never disagrees with the grid: choosing PUBLISHED
 * publishes, and choosing DRAFT takes it back. */
export type WeekStatus = "NOT_PRACTISING" | "EMPTY" | "DRAFT" | "PUBLISHED";

export interface WeekTrackerRow {
  danceId: string;
  danceName: string;
  defaultDurationMinutes: number;
  weekOff: boolean;
  status: WeekStatus;
  /** Published practices carrying an edit nobody has been told about yet. */
  pendingChanges: number;
  /** Set when this week was cancelled after being published and the cast
   * still hasn't been told. */
  pendingCancellation: number;
  practices: {
    id: string;
    startDateTime: Date;
    endDateTime: Date;
    spaceId: string | null;
    spaceName: string | null;
    status: "PROPOSED" | "CONFIRMED";
    pendingAnnouncement: boolean;
    pendingChangeNote: string | null;
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
  const pendingCancelById = new Map(
    weeksOff
      .filter((w) => w.pendingCancellationNotice)
      .map((w) => [w.danceId, w.cancelledPracticeCount]),
  );

  return dances.map((dance) => {
    const mine = practices.filter((p) => p.danceId === dance.id);
    const status: WeekStatus = offIds.has(dance.id)
      ? "NOT_PRACTISING"
      : mine.length === 0
        ? "EMPTY"
        : mine.every((p) => p.status === "CONFIRMED")
          ? "PUBLISHED"
          : "DRAFT";

    return {
      danceId: dance.id,
      danceName: dance.name,
      defaultDurationMinutes: dance.defaultDurationMinutes,
      weekOff: offIds.has(dance.id),
      status,
      pendingChanges: mine.filter((p) => p.pendingAnnouncement).length,
      pendingCancellation: pendingCancelById.get(dance.id) ?? 0,
      practices: mine.map((p) => ({
        id: p.id,
        startDateTime: p.startDateTime,
        endDateTime: p.endDateTime,
        spaceId: p.spaceId,
        spaceName: p.space?.name ?? null,
        status: p.status,
        pendingAnnouncement: p.pendingAnnouncement,
        pendingChangeNote: p.pendingChangeNote,
      })),
    };
  });
}

export interface PracticeDetail {
  id: string;
  danceId: string;
  danceName: string;
  spaceId: string | null;
  spaceName: string | null;
  startIso: string;
  endIso: string;
  status: "PROPOSED" | "CONFIRMED";
  pendingAnnouncement: boolean;
  pendingChangeNote: string | null;
  hasEnded: boolean;
  attendanceSubmitted: boolean;
  castSize: number;
  plannedArrivals: { userId: string; name: string; arriveAtIso: string }[];
  /** Rooms free for this practice's window, plus the one it's already in. */
  availableSpaces: { id: string; name: string }[];
}

/** Everything one practice needs to be edited in one place.
 *
 * Before this, changing a room meant deleting the practice and building it
 * again from scratch, which lost its late arrivals and re-announced it to the
 * cast. Room, time, status and who's arriving late are all one panel now. */
export async function getPracticeDetail(
  practiceId: string,
): Promise<PracticeDetail> {
  await requireAdmin();
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    include: {
      dance: { select: { name: true, memberships: { select: { userId: true } } } },
      space: { select: { name: true } },
      plannedArrivals: { include: { user: { select: { name: true, email: true } } } },
    },
  });

  const [spaces, clashes] = await Promise.all([
    prisma.space.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.practice.findMany({
      where: {
        id: { not: practiceId },
        startDateTime: { lt: practice.endDateTime },
        endDateTime: { gt: practice.startDateTime },
      },
      select: { spaceId: true },
    }),
  ]);
  const taken = new Set(clashes.map((c) => c.spaceId).filter(Boolean));

  return {
    id: practice.id,
    danceId: practice.danceId,
    danceName: practice.dance.name,
    spaceId: practice.spaceId,
    spaceName: practice.space?.name ?? null,
    startIso: practice.startDateTime.toISOString(),
    endIso: practice.endDateTime.toISOString(),
    status: practice.status,
    pendingAnnouncement: practice.pendingAnnouncement,
    pendingChangeNote: practice.pendingChangeNote,
    hasEnded: practice.endDateTime < new Date(),
    attendanceSubmitted: practice.attendanceSubmittedAt !== null,
    castSize: practice.dance.memberships.length,
    plannedArrivals: practice.plannedArrivals.map((a) => ({
      userId: a.userId,
      name: a.user.name ?? a.user.email,
      arriveAtIso: a.arriveAt.toISOString(),
    })),
    availableSpaces: spaces.filter(
      (s) => !taken.has(s.id) || s.id === practice.spaceId,
    ),
  };
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
    select: { status: true, startDateTime: true, endDateTime: true },
  });

  const start = new Date(startDateTime);
  const end = new Date(endDateTime);
  const moved =
    before.startDateTime.getTime() !== start.getTime() ||
    before.endDateTime.getTime() !== end.getTime();

  await prisma.practice.update({
    where: { id: practiceId },
    data: {
      startDateTime: start,
      endDateTime: end,
      // A published practice that moves is staged, not announced. The AD
      // shifts things around several times in one sitting; sending on every
      // drag meant the cast got three messages for one decision and started
      // ignoring all of them. "Publish changes" is what sends.
      ...(before.status === "CONFIRMED" && moved
        ? {
            pendingAnnouncement: true,
            pendingChangeNote: `moved to ${changeFormatter.format(start)}`,
          }
        : {}),
    },
  });

  // The shared calendar still follows immediately — it's a reference, not a
  // notification, and a stale one is worse than a quiet one.
  if (before.status === "CONFIRMED") {
    await syncPracticeToTeamCalendar(practiceId);
  }

  revalidatePath("/admin/schedule-builder");
  revalidatePath("/schedule");
}

/** Moves a practice to a different room. Late room changes are the single
 * most common edit the AD makes, and until now the only way to make one was
 * to delete the practice and rebuild it. */
export async function updatePracticeSpace(
  practiceId: string,
  spaceId: string | null,
) {
  await requireAdmin();
  const before = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: {
      status: true,
      spaceId: true,
      startDateTime: true,
      endDateTime: true,
    },
  });
  if (before.spaceId === spaceId) return;

  if (spaceId) {
    const clash = await prisma.practice.findFirst({
      where: {
        id: { not: practiceId },
        spaceId,
        startDateTime: { lt: before.endDateTime },
        endDateTime: { gt: before.startDateTime },
      },
      select: { dance: { select: { name: true } } },
    });
    if (clash) {
      throw new Error(`${clash.dance.name} already has that room then`);
    }
  }

  const space = spaceId
    ? await prisma.space.findUnique({
        where: { id: spaceId },
        select: { name: true },
      })
    : null;

  await prisma.practice.update({
    where: { id: practiceId },
    data: {
      spaceId,
      ...(before.status === "CONFIRMED"
        ? {
            pendingAnnouncement: true,
            pendingChangeNote: space
              ? `room changed to ${space.name}`
              : "room to be confirmed",
          }
        : {}),
    },
  });

  if (before.status === "CONFIRMED") {
    await syncPracticeToTeamCalendar(practiceId);
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

  const now = new Date();
  await prisma.practice.update({
    where: { id: practiceId },
    data: {
      status: "CONFIRMED",
      publishedAt: now,
      announcedAt: now,
      pendingAnnouncement: false,
      pendingChangeNote: null,
    },
  });

  // Only announce the transition, so re-confirming an already-confirmed
  // practice doesn't spam the cast a second time.
  if (existing.status !== "CONFIRMED") {
    await notifyPracticeConfirmed(practiceId);
  }
  await syncPracticeToTeamCalendar(practiceId);

  revalidateSchedule();
}

/** Takes a practice back off the board without deleting it.
 *
 * Deliberately silent. Going back to draft is the AD reopening something to
 * work on, not a decision the cast needs to hear about that second — and it
 * used to fire "cancelled" at everyone the moment the dropdown moved, which
 * made the dropdown unusable. It comes off the shared calendar and is marked
 * as having an unsent change, so announcing it stays available and deliberate.
 *
 * Actually cancelling a week is a different act: see `setWeekStatus`. */
export async function unpublishPractice(practiceId: string) {
  await requireAdmin();
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { status: true },
  });
  if (practice.status !== "CONFIRMED") return;

  await removePracticeFromTeamCalendar(practiceId);
  await prisma.practice.update({
    where: { id: practiceId },
    data: {
      status: "PROPOSED",
      pendingAnnouncement: true,
      pendingChangeNote: "taken off the schedule",
    },
  });

  revalidateSchedule();
}

export interface PublishResult {
  published: number;
  announced: number;
  peopleNotified: number;
  /** Dances with nothing booked this week that aren't marked as off. Set
   * when the publish was refused; empty when it went through. */
  missing: string[];
  /** Published practices cleared by marking the week as not practising.
   * Non-zero means there's a cancellation the cast hasn't been told about. */
  cancelledPublished?: number;
}

/** Publishes one dance's drafts for one week.
 *
 * Per-dance publish exists because a week is rarely finished all at once: one
 * choreographer confirms on Sunday and another on Tuesday, and re-publishing
 * the whole week to get that second dance out would re-announce the first to
 * everyone in it. */
export async function publishDance(
  danceId: string,
  weekOfIso: string,
): Promise<PublishResult> {
  await requireAdmin();
  return publishScope({ danceId, weekOfIso });
}

/** Publishes every dance's drafts for a week.
 *
 * Refuses, rather than half-publishing, when a dance has nothing booked and
 * hasn't been marked as not practising. That case is almost always the AD
 * having missed one — and a schedule that goes out missing a dance is worse
 * than one that goes out late, because the cast reads "no practice" as
 * settled. `force` is the AD saying they meant it. */
export async function publishWeek(
  weekOfIso: string,
  force = false,
): Promise<PublishResult> {
  await requireAdmin();

  if (!force) {
    const missing = await dancesWithNothingBooked(weekOfIso);
    if (missing.length > 0) {
      return { published: 0, announced: 0, peopleNotified: 0, missing };
    }
  }
  return publishScope({ weekOfIso });
}

/** Active dances that have neither a practice nor a week-off marker for the
 * given week — the publish guardrail's evidence. */
export async function dancesWithNothingBooked(
  weekOfIso: string,
): Promise<string[]> {
  await requireAdmin();
  const weekOf = startOfWeek(new Date(weekOfIso));
  const weekEnd = new Date(weekOf.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [dances, practices, weeksOff] = await Promise.all([
    prisma.dance.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.practice.findMany({
      where: { startDateTime: { gte: weekOf, lt: weekEnd } },
      select: { danceId: true },
    }),
    prisma.danceWeekOff.findMany({ where: { weekOf }, select: { danceId: true } }),
  ]);

  const booked = new Set(practices.map((p) => p.danceId));
  const off = new Set(weeksOff.map((w) => w.danceId));
  return dances
    .filter((d) => !booked.has(d.id) && !off.has(d.id))
    .map((d) => d.name);
}

/** The shared body of both publish paths: send new practices out, send staged
 * edits out, and do each as one message per person rather than one per
 * practice. */
async function publishScope(scope: {
  weekOfIso: string;
  danceId?: string;
}): Promise<PublishResult> {
  const weekOf = startOfWeek(new Date(scope.weekOfIso));
  const weekEnd = new Date(weekOf.getTime() + 7 * 24 * 60 * 60 * 1000);
  const window = {
    startDateTime: { gte: weekOf, lt: weekEnd },
    ...(scope.danceId ? { danceId: scope.danceId } : {}),
    dance: { archivedAt: null },
  };

  const [drafts, staged] = await Promise.all([
    prisma.practice.findMany({
      where: { ...window, status: "PROPOSED" as const },
      select: {
        id: true,
        dance: { select: { memberships: { select: { userId: true } } } },
      },
    }),
    prisma.practice.findMany({
      where: { ...window, status: "CONFIRMED" as const, pendingAnnouncement: true },
      select: { id: true },
    }),
  ]);

  const draftIds = drafts.map((d) => d.id);
  const stagedIds = staged.map((s) => s.id);
  const now = new Date();

  if (draftIds.length > 0) {
    await prisma.practice.updateMany({
      where: { id: { in: draftIds } },
      data: {
        status: "CONFIRMED",
        publishedAt: now,
        announcedAt: now,
        pendingAnnouncement: false,
        pendingChangeNote: null,
      },
    });
    await notifySchedulePublished(draftIds);
    for (const id of draftIds) await syncPracticeToTeamCalendar(id);
  }

  let announcedPeople = 0;
  if (stagedIds.length > 0) {
    announcedPeople = await announcePracticeChanges(stagedIds);
    await prisma.practice.updateMany({
      where: { id: { in: stagedIds } },
      data: {
        announcedAt: now,
        pendingAnnouncement: false,
        pendingChangeNote: null,
      },
    });
  }

  const people = new Set(
    drafts.flatMap((d) => d.dance.memberships.map((m) => m.userId)),
  );

  revalidateSchedule();
  return {
    published: draftIds.length,
    announced: stagedIds.length,
    peopleNotified: people.size + announcedPeople,
    missing: [],
  };
}

/** Publishes the whole draft schedule in one go, across every week — the
 * "I've laid out the term, send it" button. */
export async function confirmAllDrafts(): Promise<{
  confirmed: number;
  peopleNotified: number;
}> {
  await requireAdmin();

  const drafts = await prisma.practice.findMany({
    where: { status: "PROPOSED", dance: { archivedAt: null } },
    select: { id: true, dance: { select: { memberships: { select: { userId: true } } } } },
  });
  if (drafts.length === 0) return { confirmed: 0, peopleNotified: 0 };

  const ids = drafts.map((d) => d.id);
  const now = new Date();
  await prisma.practice.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "CONFIRMED",
      publishedAt: now,
      announcedAt: now,
      pendingAnnouncement: false,
      pendingChangeNote: null,
    },
  });

  await notifySchedulePublished(ids);
  // The shared team calendar fills itself in as part of publishing.
  for (const id of ids) {
    await syncPracticeToTeamCalendar(id);
  }

  const people = new Set(
    drafts.flatMap((d) => d.dance.memberships.map((m) => m.userId)),
  );

  revalidateSchedule();
  return { confirmed: ids.length, peopleNotified: people.size };
}

function revalidateSchedule() {
  revalidatePath("/admin/schedule-builder");
  revalidatePath("/admin/attendance");
  revalidatePath("/schedule");
  revalidatePath("/notifications");
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

/** The dropdown on each tracker row. One action so the label the AD picks and
 * what actually happens can never drift apart.
 *
 * Publishing from here goes through the same per-dance path as the Publish
 * button, so it also carries out any staged edits for that dance. */
export async function setWeekStatus(
  danceId: string,
  weekOfIso: string,
  status: Exclude<WeekStatus, "EMPTY">,
): Promise<PublishResult> {
  await requireAdmin();
  const weekOf = startOfWeek(new Date(weekOfIso));
  const weekEnd = new Date(weekOf.getTime() + 7 * 24 * 60 * 60 * 1000);

  if (status === "NOT_PRACTISING") {
    // Cancelling a week that was already published is the one case where the
    // cast genuinely needs telling — but it is still the AD's call, not a
    // side effect of moving a dropdown. The practices go; the message waits
    // behind a prompt on the tracker.
    const published = await prisma.practice.count({
      where: {
        danceId,
        status: "CONFIRMED",
        startDateTime: { gte: weekOf, lt: weekEnd },
      },
    });

    const practices = await prisma.practice.findMany({
      where: { danceId, startDateTime: { gte: weekOf, lt: weekEnd } },
      select: { id: true },
    });
    for (const p of practices) {
      await removePracticeFromTeamCalendar(p.id);
    }
    await prisma.practice.deleteMany({
      where: { id: { in: practices.map((p) => p.id) } },
    });

    await prisma.danceWeekOff.upsert({
      where: { danceId_weekOf: { danceId, weekOf } },
      update: {
        pendingCancellationNotice: published > 0,
        cancelledPracticeCount: published,
      },
      create: {
        danceId,
        weekOf,
        pendingCancellationNotice: published > 0,
        cancelledPracticeCount: published,
      },
    });

    revalidateSchedule();
    return {
      published: 0,
      announced: 0,
      peopleNotified: 0,
      missing: [],
      cancelledPublished: published,
    };
  }

  await prisma.danceWeekOff.deleteMany({ where: { danceId, weekOf } });

  if (status === "PUBLISHED") {
    return publishScope({ danceId, weekOfIso });
  }

  // Back to draft: take every published practice for this dance off the
  // board, telling the cast once, so "draft" means the same thing here as it
  // does everywhere else — nobody outside this screen is counting on it.
  const published = await prisma.practice.findMany({
    where: {
      danceId,
      status: "CONFIRMED",
      startDateTime: { gte: weekOf, lt: weekEnd },
    },
    select: { id: true },
  });
  for (const p of published) {
    await unpublishPractice(p.id);
  }

  revalidateSchedule();
  return { published: 0, announced: 0, peopleNotified: 0, missing: [] };
}

/** Sends the cancellation the AD staged by marking a week as not practising.
 *
 * Separate from marking the week off on purpose. Cancelling and announcing a
 * cancellation are two decisions, and conflating them is how a dropdown ends
 * up messaging forty people by accident. */
export async function announceWeekCancelled(
  danceId: string,
  weekOfIso: string,
): Promise<{ notified: number }> {
  await requireAdmin();
  const weekOf = startOfWeek(new Date(weekOfIso));

  const off = await prisma.danceWeekOff.findUnique({
    where: { danceId_weekOf: { danceId, weekOf } },
  });
  if (!off?.pendingCancellationNotice) return { notified: 0 };

  const notified = await notifyWeekCancelled(danceId, weekOf);

  await prisma.danceWeekOff.update({
    where: { id: off.id },
    data: { pendingCancellationNotice: false },
  });
  revalidateSchedule();
  return { notified };
}

/** Drops the prompt without sending — "they already know". */
export async function dismissWeekCancellationNotice(
  danceId: string,
  weekOfIso: string,
) {
  await requireAdmin();
  const weekOf = startOfWeek(new Date(weekOfIso));
  await prisma.danceWeekOff.updateMany({
    where: { danceId, weekOf },
    data: { pendingCancellationNotice: false },
  });
  revalidateSchedule();
}

/** Takes one person out of one dance's scheduling for one week — and leaves a
 * record saying why.
 *
 * The dancer half of this used to be a checkbox held in the browser. It
 * changed the suggestions and then evaporated: no trace of who was left out,
 * or why, and if a practice went ahead anyway they could be marked down as an
 * unexcused absence for a week the app itself had removed them from.
 *
 * The reason defaults to whatever conflicts prompted it, so the common case
 * needs no typing. */
export async function setWeeklyExclusion(
  danceId: string,
  userId: string,
  weekOfIso: string,
  excluded: boolean,
  reason?: string,
) {
  const admin = await requireAdmin();
  const weekOf = startOfWeek(new Date(weekOfIso));

  if (!excluded) {
    await prisma.weeklyExclusion.deleteMany({ where: { danceId, userId, weekOf } });
    revalidateSchedule();
    return;
  }

  const text = (reason ?? "").trim() || (await describeWeekConflicts(userId, weekOf));

  await prisma.weeklyExclusion.upsert({
    where: { danceId_userId_weekOf: { danceId, userId, weekOf } },
    update: { reason: text, createdById: admin.id },
    create: { danceId, userId, weekOf, reason: text, createdById: admin.id },
  });
  revalidateSchedule();
}

/** Turns that week's conflicts into a sentence, so the record says something
 * useful without the AD having to write it. */
async function describeWeekConflicts(
  userId: string,
  weekOf: Date,
): Promise<string> {
  const weekEnd = new Date(weekOf.getTime() + 7 * 24 * 60 * 60 * 1000);
  const conflicts = await prisma.conflict.findMany({
    where: { userId, startDateTime: { gte: weekOf, lt: weekEnd } },
    orderBy: { startDateTime: "asc" },
    take: 3,
    select: { title: true, startDateTime: true },
  });
  if (conflicts.length === 0) return "Left out of this week's scheduling";
  return conflicts
    .map((c) => `${c.title ?? "Conflict"} (${changeFormatter.format(c.startDateTime)})`)
    .join("; ");
}
