"use server";

/** Putting somebody's practices onto their own Google Calendar.
 *
 * The whole difficulty here is repeat runs. Practices move — that is the
 * point of the app — so this gets pressed again after every reschedule. If a
 * second run couldn't find what the first one wrote, every run would leave
 * another copy behind until the week was unreadable. So each written event is
 * recorded in PracticeCalendarExport, keyed by person and practice, and a
 * later run patches that event instead of creating a new one.
 *
 * Only published practices are written. A draft is the AD still thinking;
 * putting drafts in forty calendars would notify everyone of a plan that
 * might not survive the afternoon.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";
import {
  describeGoogleError,
  getGoogleCalendarClientForUser,
} from "@/lib/google-calendar";
import { activeRange } from "@/lib/terms";

export type PracticeExportResult = {
  added: number;
  updated: number;
  removed: number;
  /** Practices considered, so "0 added" can be told apart from "nothing to
   * add" — the same trap the spaces and conflict syncs used to fall into. */
  practicesSeen: number;
  calendarName: string;
  failures: string[];
};

/** Practices go to the person's main calendar.
 *
 * Deliberately never their conflict calendar. That one says when they're
 * busy and is read back on every conflict sync, so writing practices into it
 * would feed the app's own output back in as input — and the scheduler would
 * start treating a rehearsal as a reason someone can't rehearse.
 *
 * The event id is recorded per calendar, so if this ever becomes a choice,
 * events written to the old one can still be found and cleaned up. */
const TARGET_CALENDAR_ID = "primary";

/** Writes every published practice this person is cast in to their calendar.
 *
 * Runs over the active term rather than a single week, because the ask is to
 * stop doing this one dance at a time. */
export async function syncMyPracticesToGoogle(): Promise<PracticeExportResult> {
  const user = await requireUser();
  const calendarId = TARGET_CALENDAR_ID;
  const { range } = await activeRange();

  const practices = await prisma.practice.findMany({
    where: {
      status: "CONFIRMED",
      startDateTime: { gte: range.start, lt: range.end },
      dance: {
        archivedAt: null,
        memberships: { some: { userId: user.id } },
      },
    },
    include: {
      dance: { select: { name: true } },
      space: { select: { name: true, location: true } },
    },
    orderBy: { startDateTime: "asc" },
  });

  const exports = await prisma.practiceCalendarExport.findMany({
    where: { userId: user.id },
  });
  const exportByPractice = new Map(exports.map((e) => [e.practiceId, e]));

  const calendar = await getGoogleCalendarClientForUser(user.id).catch(
    (error) => {
      throw describeGoogleError(error);
    },
  );

  let added = 0;
  let updated = 0;
  let removed = 0;
  const failures: string[] = [];

  for (const practice of practices) {
    const body = {
      summary: `${practice.dance.name} rehearsal`,
      location: practice.space
        ? [practice.space.name, practice.space.location]
            .filter(Boolean)
            .join(", ")
        : undefined,
      description: "Added by PADT Calendar. Moves when the schedule moves.",
      start: { dateTime: practice.startDateTime.toISOString() },
      end: { dateTime: practice.endDateTime.toISOString() },
    };

    const existing = exportByPractice.get(practice.id);
    exportByPractice.delete(practice.id);

    try {
      if (existing) {
        // Patch in place. If the event has been deleted by hand at the far
        // end, Google answers 404/410 — that's a deliberate removal, so the
        // record goes rather than the event coming back uninvited.
        try {
          await calendar.events.patch({
            calendarId: existing.googleCalendarId,
            eventId: existing.googleEventId,
            requestBody: body,
          });
          updated++;
        } catch (error) {
          const status = (error as { code?: number })?.code;
          if (status !== 404 && status !== 410) throw error;
          await prisma.practiceCalendarExport.delete({
            where: { id: existing.id },
          });
        }
      } else {
        const created = await calendar.events.insert({
          calendarId,
          requestBody: body,
        });
        if (created.data.id) {
          await prisma.practiceCalendarExport.create({
            data: {
              userId: user.id,
              practiceId: practice.id,
              googleCalendarId: calendarId,
              googleEventId: created.data.id,
            },
          });
          added++;
        }
      }
    } catch (error) {
      // One bad event must not abandon the rest half-written.
      failures.push(
        `${practice.dance.name}: ${describeGoogleError(error).message}`,
      );
    }
  }

  // Anything still in the map is an event for a practice that has since been
  // cancelled or unpublished. Leaving it would have people turning up to
  // rehearsals that aren't happening.
  for (const orphan of exportByPractice.values()) {
    try {
      await calendar.events.delete({
        calendarId: orphan.googleCalendarId,
        eventId: orphan.googleEventId,
      });
    } catch (error) {
      const status = (error as { code?: number })?.code;
      if (status !== 404 && status !== 410) {
        failures.push(describeGoogleError(error).message);
        continue;
      }
    }
    await prisma.practiceCalendarExport.delete({ where: { id: orphan.id } });
    removed++;
  }

  revalidatePath("/schedule");
  return {
    added,
    updated,
    removed,
    practicesSeen: practices.length,
    calendarName: calendarId === "primary" ? "your main calendar" : calendarId,
    failures,
  };
}

/** Takes every practice this person has back off their calendar. The way out
 * of having said yes — without it, "add to my calendar" is a one-way door. */
export async function removeMyPracticesFromGoogle(): Promise<{
  removed: number;
}> {
  const user = await requireUser();
  const exports = await prisma.practiceCalendarExport.findMany({
    where: { userId: user.id },
  });
  if (exports.length === 0) return { removed: 0 };

  const calendar = await getGoogleCalendarClientForUser(user.id).catch(
    (error) => {
      throw describeGoogleError(error);
    },
  );

  let removed = 0;
  for (const row of exports) {
    try {
      await calendar.events.delete({
        calendarId: row.googleCalendarId,
        eventId: row.googleEventId,
      });
    } catch (error) {
      const status = (error as { code?: number })?.code;
      // Already gone is the outcome we wanted.
      if (status !== 404 && status !== 410) continue;
    }
    await prisma.practiceCalendarExport.delete({ where: { id: row.id } });
    removed++;
  }

  revalidatePath("/schedule");
  return { removed };
}
