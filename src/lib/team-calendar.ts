import { prisma } from "@/lib/prisma";
import { getGoogleCalendarClientForUser } from "@/lib/google-calendar";
import { APP_TIME_ZONE } from "@/lib/timezone";

/** Writing to the shared calendar always goes through whichever admin's
 * Google account can reach it — the calendar itself is owned by the club
 * account and shared with the ADs, so it outlives any one of them. */
async function calendarWriter() {
  const settings = await prisma.appSettings.findUnique({
    where: { id: "singleton" },
    select: { teamCalendarId: true },
  });
  if (!settings?.teamCalendarId) return null;

  const admin = await prisma.user.findFirst({
    where: { isAdmin: true, accounts: { some: { provider: "google" } } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!admin) return null;

  try {
    const calendar = await getGoogleCalendarClientForUser(admin.id);
    return { calendar, calendarId: settings.teamCalendarId };
  } catch {
    // No Google connection — the app carries on and the calendar simply
    // lags. Never block scheduling on an external service.
    return null;
  }
}

/** Which practice of the year this is for its dance. Counted in date order
 * within the dance's season, so "Bhangra 7" always means the seventh one —
 * if an earlier practice is deleted, the rest shuffle up and their calendar
 * events get retitled on the next sync. */
export async function practiceNumber(practiceId: string): Promise<number> {
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { danceId: true, startDateTime: true, dance: { select: { season: true } } },
  });

  const earlier = await prisma.practice.count({
    where: {
      danceId: practice.danceId,
      status: "CONFIRMED",
      startDateTime: { lt: practice.startDateTime },
      dance: { season: practice.dance.season },
    },
  });
  return earlier + 1;
}

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

function formatTime(date: Date): string {
  return timeFormatter.format(date);
}

/** The event body: who's excused, who isn't, who's coming late, and anything
 * written ahead of time. This is the plan as it stands at publish — it is
 * deliberately not rewritten once attendance comes in, because the record of
 * what actually happened lives in the app. */
async function buildDescription(practiceId: string): Promise<string> {
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    include: {
      dance: { include: { memberships: { include: { user: true } } } },
      plannedArrivals: { include: { user: true } },
      notes: {
        where: { subjectUserId: null },
        include: { author: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const castIds = practice.dance.memberships.map((m) => m.userId);
  const conflicts = await prisma.conflict.findMany({
    where: {
      userId: { in: castIds },
      startDateTime: { lt: practice.endDateTime },
      endDateTime: { gt: practice.startDateTime },
    },
    include: { user: true },
  });

  const nameOf = (u: { name: string | null; email: string }) => u.name ?? u.email;
  const lateIds = new Set(practice.plannedArrivals.map((p) => p.userId));

  const excused = conflicts
    .filter((c) => c.status === "EXCUSED" && !lateIds.has(c.userId))
    .map((c) => nameOf(c.user));
  const unexcused = conflicts
    .filter((c) => c.status === "UNEXCUSED" && !lateIds.has(c.userId))
    .map((c) => nameOf(c.user));
  const late = practice.plannedArrivals.map(
    (p) => `${nameOf(p.user)} (${formatTime(p.arriveAt)})`,
  );

  const lines: string[] = [];
  lines.push(`Excused: ${excused.length ? Array.from(new Set(excused)).sort().join(", ") : "nobody"}`);
  lines.push(`Unexcused: ${unexcused.length ? Array.from(new Set(unexcused)).sort().join(", ") : "nobody"}`);
  lines.push(`Coming late: ${late.length ? late.sort().join(", ") : "nobody"}`);

  if (practice.notes.length > 0) {
    lines.push("");
    lines.push("Notes:");
    for (const note of practice.notes) {
      lines.push(`• ${note.body} — ${nameOf(note.author)}`);
    }
  }

  return lines.join("\n");
}

/** Writes (or rewrites) this practice's event on the shared team calendar.
 *
 * Called from every place that changes a practice, so the calendar keeps
 * itself current — there's no "push to calendar" button to remember. The
 * event id is stored on the practice, so a move updates in place rather than
 * leaving a duplicate behind.
 *
 * Best-effort by design: a Google outage must never stop the AD scheduling. */
export async function syncPracticeToTeamCalendar(
  practiceId: string,
): Promise<"written" | "skipped" | "failed"> {
  const writer = await calendarWriter();
  if (!writer) return "skipped";

  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    include: { dance: true, space: true },
  });
  if (!practice) return "skipped";

  // Drafts are invisible to everyone but the AD, so they don't belong on a
  // calendar the whole team reads.
  if (practice.status !== "CONFIRMED") {
    return removePracticeFromTeamCalendar(practiceId);
  }

  const number = await practiceNumber(practiceId);
  const requestBody = {
    summary: `${practice.dance.name} ${number}`,
    location: practice.space?.location ?? practice.space?.name ?? undefined,
    description: await buildDescription(practiceId),
    // The instant is unambiguous on its own, but naming the zone makes the
    // event read as Eastern in Google's own UI rather than inheriting
    // whichever zone the viewing calendar happens to be set to.
    start: {
      dateTime: practice.startDateTime.toISOString(),
      timeZone: APP_TIME_ZONE,
    },
    end: {
      dateTime: practice.endDateTime.toISOString(),
      timeZone: APP_TIME_ZONE,
    },
  };

  try {
    if (practice.googleEventId) {
      await writer.calendar.events.update({
        calendarId: writer.calendarId,
        eventId: practice.googleEventId,
        requestBody,
      });
    } else {
      const { data } = await writer.calendar.events.insert({
        calendarId: writer.calendarId,
        requestBody,
      });
      if (data.id) {
        await prisma.practice.update({
          where: { id: practiceId },
          data: { googleEventId: data.id },
        });
      }
    }
    return "written";
  } catch (error) {
    // A stale event id (someone deleted it in Google) shouldn't wedge every
    // future sync — clear it so the next write creates a fresh event.
    if (practice.googleEventId) {
      await prisma.practice.update({
        where: { id: practiceId },
        data: { googleEventId: null },
      });
    }
    console.error("Team calendar sync failed", error);
    return "failed";
  }
}

export async function removePracticeFromTeamCalendar(
  practiceId: string,
): Promise<"written" | "skipped" | "failed"> {
  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    select: { googleEventId: true },
  });
  if (!practice?.googleEventId) return "skipped";

  const writer = await calendarWriter();
  if (!writer) return "skipped";

  try {
    await writer.calendar.events.delete({
      calendarId: writer.calendarId,
      eventId: practice.googleEventId,
    });
  } catch (error) {
    console.error("Team calendar delete failed", error);
    return "failed";
  } finally {
    await prisma.practice.update({
      where: { id: practiceId },
      data: { googleEventId: null },
    });
  }
  return "written";
}

/** Renumbering is a side effect of deleting a practice: everything after it
 * in the same dance shifts up, so their titles are now wrong. */
export async function resyncDanceCalendar(danceId: string): Promise<void> {
  const practices = await prisma.practice.findMany({
    where: { danceId, status: "CONFIRMED", googleEventId: { not: null } },
    select: { id: true },
    orderBy: { startDateTime: "asc" },
  });
  for (const practice of practices) {
    await syncPracticeToTeamCalendar(practice.id);
  }
}
