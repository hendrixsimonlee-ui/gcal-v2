"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { syncPracticeToTeamCalendar } from "@/lib/team-calendar";

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
