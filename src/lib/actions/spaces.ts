"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import {
  checkTeamCalendarAccess,
  syncPracticeToTeamCalendar,
} from "@/lib/team-calendar";
import { addDays, startOfWeek } from "@/lib/dates";

/** What's left here is the *team* calendar — where published practices are
 * written out to. Rooms are no longer managed from the app at all; they come
 * from the shared spaces calendar and live in spaces-calendar.ts. */

/** Points the app at the shared team calendar every published practice gets
 * written to. Owned by the club account and shared with the AD, so it
 * survives ADs changing. */
export async function setTeamCalendar(formData: FormData) {
  await requireAdmin();
  const calendarId = String(formData.get("calendarId") ?? "").trim();
  const calendarName = String(formData.get("calendarName") ?? "").trim();

  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {
      teamCalendarId: calendarId || null,
      teamCalendarName: calendarId ? calendarName || calendarId : null,
    },
    create: {
      id: "singleton",
      teamCalendarId: calendarId || null,
      teamCalendarName: calendarId ? calendarName || calendarId : null,
    },
  });
  revalidatePath("/admin/settings");
}

/** Rewrites every upcoming published practice onto the team calendar. For
 * after linking it for the first time, or if it drifted. */
export async function resyncTeamCalendar(): Promise<number> {
  await requireAdmin();
  const practices = await prisma.practice.findMany({
    where: {
      status: "CONFIRMED",
      endDateTime: { gte: new Date() },
      dance: { archivedAt: null },
    },
    select: { id: true },
    orderBy: { startDateTime: "asc" },
  });

  let written = 0;
  for (const practice of practices) {
    if ((await syncPracticeToTeamCalendar(practice.id)) === "written") written++;
  }
  revalidatePath("/admin/settings");
  return written;
}

export type TeamCalendarExport = {
  /** Whether a team calendar has been picked in Settings at all. When this is
   * false nothing was written and nothing was wrong — the app simply has
   * nowhere to write to, which is the state it silently sat in before. */
  linked: boolean;
  calendarName: string | null;
  /** Published practices in the week that reached Google. */
  written: number;
  /** Published practices the write failed for — a dead Google token, or the
   * calendar no longer shared with this AD. */
  failed: number;
  /** Published practices found in the week. `written + failed` should equal
   * this; if it doesn't, the rest were skipped for want of a calendar. */
  published: number;
  /** Why nothing could be written, when nothing was. Null when it worked, or
   * when there was nothing to write. */
  problem?: string | null;
  /** Drafts sitting in the week, deliberately left alone. Reported so the AD
   * can see why a practice they're looking at didn't go across. */
  drafts: number;
};

/** Whether the app has somewhere to write published practices. */
export async function getTeamCalendarStatus(): Promise<{
  linked: boolean;
  calendarName: string | null;
}> {
  await requireAdmin();
  const settings = await prisma.appSettings.findUnique({
    where: { id: "singleton" },
    select: { teamCalendarId: true, teamCalendarName: true },
  });
  return {
    linked: Boolean(settings?.teamCalendarId),
    calendarName: settings?.teamCalendarName ?? null,
  };
}

/** Pushes one week's published practices onto the shared team calendar.
 *
 * Publishing already does this automatically. This exists because it used to
 * do it *silently*: the sync result was discarded, so an AD who had never
 * linked a calendar in Settings — or whose Google token had expired — was
 * told "published 6 practices" while nothing reached Google, with no way to
 * tell the difference from the app.
 *
 * So this reports numbers rather than just running, and it is per-week rather
 * than all-future, because the AD is looking at one week when they want to
 * check it. Safe to press repeatedly: each practice keeps its calendar event
 * id, so a second run updates the same events instead of duplicating them.
 *
 * Drafts are never written. The team calendar is something forty people read,
 * and a draft is a time the AD hasn't committed to — publishing stays the one
 * act that puts a practice in front of the team. */
export async function exportWeekToTeamCalendar(
  weekOfIso: string,
): Promise<TeamCalendarExport> {
  const admin = await requireAdmin();

  const { linked, calendarName } = await getTeamCalendarStatus();
  const weekStart = startOfWeek(new Date(weekOfIso));
  const weekEnd = addDays(weekStart, 7);

  const practices = await prisma.practice.findMany({
    where: {
      startDateTime: { gte: weekStart, lt: weekEnd },
      dance: { archivedAt: null },
    },
    select: { id: true, status: true },
    orderBy: { startDateTime: "asc" },
  });

  const published = practices.filter((p) => p.status === "CONFIRMED");
  const drafts = practices.length - published.length;

  if (!linked) {
    return {
      linked: false,
      calendarName: null,
      written: 0,
      failed: 0,
      published: published.length,
      drafts,
    };
  }

  let written = 0;
  let failed = 0;
  for (const practice of published) {
    // The AD pressing the button is tried first. Writing used to always go
    // through the oldest admin with a Google account, so a stale connection
    // on somebody else's login broke it for everyone.
    const result = await syncPracticeToTeamCalendar(practice.id, admin.id);
    if (result === "written") written++;
    else failed++;
  }

  // If nothing landed, say why rather than guessing. The old message blamed
  // an expired sign-in every time, which was sometimes true and sometimes
  // completely misleading.
  const problem =
    written === 0 && published.length > 0
      ? (await checkTeamCalendarAccess(admin.id)).message
      : null;

  revalidatePath("/admin/schedule-builder");
  return {
    linked: true,
    calendarName,
    written,
    failed,
    published: published.length,
    drafts,
    problem,
  };
}
