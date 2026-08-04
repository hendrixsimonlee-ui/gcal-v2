"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUser } from "@/lib/authz";
import { startOfWeek, addDays, formatWeekLabel } from "@/lib/dates";
import { notifyConflictsDue } from "@/lib/notify";
import { clampToSupportedRange } from "@/lib/timezone";
import { activeRange } from "@/lib/terms";
import {
  getGoogleCalendarClientForUser,
  listAllEvents,
  listGoogleCalendarsForUser,
  type GoogleCalendarSummary,
} from "@/lib/google-calendar";

// Recurring conflicts are materialized as independent rows up front (rather
// than projected on read) so each week's instance is directly editable or
// deletable by the dancer or the AD, per the "AD has admin access over
// these conflicts" requirement.
const RECURRING_WEEKS_AHEAD = 10;

/** Adds a conflict (and its future weekly occurrences, if recurring).
 * Called from the calendar's drag-to-create and its add panel. */
export async function addConflict(input: {
  startDateTime: string;
  endDateTime: string;
  title: string;
  isRecurring: boolean;
}) {
  const session = await auth();
  const userId = session!.user.id;

  const start = new Date(input.startDateTime);
  const end = new Date(input.endDateTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Please provide a valid start and end time");
  }
  if (start >= end) {
    throw new Error("Start time must be before end time");
  }

  const occurrences = input.isRecurring ? RECURRING_WEEKS_AHEAD : 1;
  await prisma.conflict.createMany({
    data: Array.from({ length: occurrences }, (_, i) => {
      const occStart = addDays(start, i * 7);
      const occEnd = addDays(end, i * 7);
      return {
        userId,
        weekOf: startOfWeek(occStart),
        startDateTime: occStart,
        endDateTime: occEnd,
        title: input.title.trim() || null,
        isRecurring: input.isRecurring,
        recurrenceRule: input.isRecurring ? "WEEKLY" : null,
      };
    }),
  });
  revalidatePath("/conflicts");
}

/** Drag/resize on the calendar. Moves only this occurrence — a recurring
 * conflict's other weeks are separate rows and stay put. */
export async function updateConflictTime(
  conflictId: string,
  startDateTime: string,
  endDateTime: string,
) {
  const session = await auth();
  const conflict = await prisma.conflict.findUniqueOrThrow({
    where: { id: conflictId },
  });
  if (conflict.userId !== session!.user.id && !session!.user.isAdmin) {
    throw new Error("Not authorized to edit this conflict");
  }

  const start = new Date(startDateTime);
  const end = new Date(endDateTime);
  if (start >= end) throw new Error("Start time must be before end time");

  await prisma.conflict.update({
    where: { id: conflictId },
    data: {
      startDateTime: start,
      endDateTime: end,
      weekOf: startOfWeek(start),
    },
  });
  revalidatePath("/conflicts");
  revalidatePath("/admin/conflicts");
  revalidatePath("/admin/roster");
}

export async function deleteConflict(conflictId: string) {
  const session = await auth();
  const conflict = await prisma.conflict.findUniqueOrThrow({
    where: { id: conflictId },
  });
  if (conflict.userId !== session!.user.id && !session!.user.isAdmin) {
    throw new Error("Not authorized to delete this conflict");
  }
  await prisma.conflict.delete({ where: { id: conflictId } });
  revalidatePath("/conflicts");
  revalidatePath("/admin/conflicts");
}

/** Rename a conflict. The title is all a dancer supplies now, so it's the
 * only thing they can edit besides the time. */
export async function updateConflictTitle(conflictId: string, title: string) {
  const session = await auth();
  const conflict = await prisma.conflict.findUniqueOrThrow({
    where: { id: conflictId },
  });
  if (conflict.userId !== session!.user.id && !session!.user.isAdmin) {
    throw new Error("Not authorized to edit this conflict");
  }
  await prisma.conflict.update({
    where: { id: conflictId },
    data: { title: title.trim() || null },
  });
  revalidatePath("/conflicts");
  revalidatePath("/admin/conflicts");
}

/** The AD's call on one conflict. Dancers don't categorise anything any more;
 * excused vs unexcused is entirely the AD's, and NOT_REVIEWED is a real state
 * so the review screen can show what hasn't been looked at. */
export async function setConflictStatus(
  conflictId: string,
  status: "NOT_REVIEWED" | "EXCUSED" | "UNEXCUSED",
) {
  const admin = await requireAdmin();
  await prisma.conflict.update({
    where: { id: conflictId },
    data: {
      status,
      reviewedById: status === "NOT_REVIEWED" ? null : admin.id,
      reviewedAt: status === "NOT_REVIEWED" ? null : new Date(),
    },
  });
  revalidatePath("/admin/conflicts");
  revalidatePath("/conflicts");
  revalidatePath("/admin/schedule-builder");
}

/** Mark everything one person logged in a week at once — the common case
 * when their whole week is classes. */
export async function setWeekConflictStatus(
  userId: string,
  weekOfIso: string,
  status: "EXCUSED" | "UNEXCUSED",
) {
  const admin = await requireAdmin();
  await prisma.conflict.updateMany({
    where: { userId, weekOf: startOfWeek(new Date(weekOfIso)) },
    data: { status, reviewedById: admin.id, reviewedAt: new Date() },
  });
  revalidatePath("/admin/conflicts");
  revalidatePath("/admin/schedule-builder");
}

/** "My conflicts for this week are in."
 *
 * Without this the AD can't tell an empty week from an unanswered one, and
 * every week began with chasing forty people to find out which was which.
 * Submitting doesn't lock anything — someone remembering a class on Wednesday
 * can still add it, and doing so quietly leaves the week submitted, because
 * the point is "I've thought about it", not "this is now frozen". */
export async function submitWeeklyConflicts(weekOfIso: string) {
  const user = await requireUser();
  const weekOf = startOfWeek(new Date(weekOfIso));

  await prisma.conflictSubmission.upsert({
    where: { userId_weekOf: { userId: user.id, weekOf } },
    update: { submittedAt: new Date() },
    create: { userId: user.id, weekOf },
  });
  revalidatePath("/conflicts");
  revalidatePath("/admin/conflicts");
}

export async function unsubmitWeeklyConflicts(weekOfIso: string) {
  const user = await requireUser();
  const weekOf = startOfWeek(new Date(weekOfIso));
  await prisma.conflictSubmission.deleteMany({
    where: { userId: user.id, weekOf },
  });
  revalidatePath("/conflicts");
  revalidatePath("/admin/conflicts");
}

export interface ConflictSubmissionRow {
  userId: string;
  name: string;
  email: string;
  submittedAtIso: string | null;
  nudgedAtIso: string | null;
  conflictCount: number;
  hasCalendarLinked: boolean;
}

/** Who has answered for a week and who hasn't — the AD's dashboard.
 *
 * Everyone on the roster appears, so the answer to "who's outstanding?" is
 * read off one screen rather than reconstructed from who happens to have
 * logged something. */
export async function getWeeklySubmissions(
  weekOfIso: string,
): Promise<ConflictSubmissionRow[]> {
  await requireAdmin();
  const weekOf = startOfWeek(new Date(weekOfIso));
  const weekEnd = addDays(weekOf, 7);

  const [users, submissions, conflicts] = await Promise.all([
    prisma.user.findMany({
      where: { memberships: { some: {} } },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        conflictCalendarId: true,
      },
    }),
    prisma.conflictSubmission.findMany({ where: { weekOf } }),
    prisma.conflict.findMany({
      where: { startDateTime: { gte: weekOf, lt: weekEnd } },
      select: { userId: true },
    }),
  ]);

  const byUser = new Map(submissions.map((s) => [s.userId, s]));
  const counts = new Map<string, number>();
  for (const c of conflicts) {
    counts.set(c.userId, (counts.get(c.userId) ?? 0) + 1);
  }

  return users.map((u) => ({
    userId: u.id,
    name: u.name ?? u.email,
    email: u.email,
    submittedAtIso: byUser.get(u.id)?.submittedAt?.toISOString() ?? null,
    nudgedAtIso: byUser.get(u.id)?.nudgedAt?.toISOString() ?? null,
    conflictCount: counts.get(u.id) ?? 0,
    hasCalendarLinked: Boolean(u.conflictCalendarId),
  }));
}

/** Nudges everyone who hasn't submitted for a week. Only them — a reminder
 * that reaches people who already did the thing is how a team learns to
 * ignore reminders. */
export async function nudgeMissingSubmissions(
  weekOfIso: string,
): Promise<{ nudged: number }> {
  await requireAdmin();
  const weekOf = startOfWeek(new Date(weekOfIso));
  const rows = await getWeeklySubmissions(weekOfIso);
  const missing = rows.filter((r) => r.submittedAtIso === null);
  if (missing.length === 0) return { nudged: 0 };

  const count = await notifyConflictsDue(
    missing.map((m) => m.userId),
    formatWeekLabel(weekOf),
  );

  // Recorded so a second nudge is a decision, not a double-click. The row
  // carries no submittedAt, so being reminded never makes anyone look like
  // they answered.
  const now = new Date();
  for (const person of missing) {
    await prisma.conflictSubmission.upsert({
      where: { userId_weekOf: { userId: person.userId, weekOf } },
      update: { nudgedAt: now },
      create: { userId: person.userId, weekOf, nudgedAt: now },
    });
  }

  revalidatePath("/admin/conflicts");
  return { nudged: count };
}

export async function addUnavailability(formData: FormData) {
  const session = await auth();
  const userId = session!.user.id;

  const startDate = new Date(String(formData.get("startDate") ?? ""));
  const endDate = new Date(String(formData.get("endDate") ?? ""));
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("Please provide valid dates");
  }
  if (startDate > endDate) {
    throw new Error("Start date must be before end date");
  }

  await prisma.unavailability.create({
    data: { userId, startDate, endDate, reason },
  });
  revalidatePath("/conflicts");
}

export async function deleteUnavailability(unavailabilityId: string) {
  const session = await auth();
  const record = await prisma.unavailability.findUniqueOrThrow({
    where: { id: unavailabilityId },
  });
  if (record.userId !== session!.user.id && !session!.user.isAdmin) {
    throw new Error("Not authorized to delete this");
  }
  await prisma.unavailability.delete({ where: { id: unavailabilityId } });
  revalidatePath("/conflicts");
}

/** The signed-in person's own Google calendars, so they can say which one is
 * their PADT conflict calendar. Returns the failure as a value rather than
 * throwing — the Conflicts page has to render whether or not Google is
 * reachable. */
export async function getMyCalendars(): Promise<
  { calendars: GoogleCalendarSummary[] } | { error: string }
> {
  const user = await requireUser();
  try {
    return { calendars: await listGoogleCalendarsForUser(user.id) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Couldn't reach Google Calendar",
    };
  }
}

/** Every calendar the club account can see — its own plus everything the
 * dancers have shared with it. This is the list the AD attaches people to. */
export async function listCalendarsVisibleToAdmin(): Promise<
  { calendars: GoogleCalendarSummary[] } | { error: string }
> {
  const admin = await requireAdmin();
  try {
    return { calendars: await listGoogleCalendarsForUser(admin.id) };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Couldn't reach Google Calendar",
    };
  }
}

export async function setConflictCalendar(formData: FormData) {
  const user = await requireUser();
  const calendarId = String(formData.get("calendarId") ?? "").trim();
  const calendarName = String(formData.get("calendarName") ?? "").trim();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      conflictCalendarId: calendarId || null,
      conflictCalendarName: calendarId ? calendarName || calendarId : null,
    },
  });
  revalidatePath("/conflicts");
}

/** Points a dancer's conflicts at a calendar the *club account* can see.
 *
 * The team's actual practice is that everyone shares their PADT conflict
 * calendar with the club Google account. That makes the AD the one person who
 * can see all of them, so the AD should be the one who can wire them up —
 * otherwise setting up a term means forty people each doing a four-step thing
 * correctly, and the ones who don't are invisible until a rehearsal lands on
 * their midterm. */
export async function setConflictCalendarForUser(
  userId: string,
  calendarId: string,
  calendarName: string,
) {
  await requireAdmin();
  await prisma.user.update({
    where: { id: userId },
    data: {
      conflictCalendarId: calendarId || null,
      conflictCalendarName: calendarId ? calendarName || calendarId : null,
    },
  });
  revalidatePath("/admin/dancer-calendars");
  revalidatePath("/admin/conflicts");
}

export interface DancerCalendarRow {
  userId: string;
  name: string;
  email: string;
  calendarId: string | null;
  calendarName: string | null;
  conflictsInTerm: number;
  lastSyncedIso: string | null;
}

/** Who's wired up and who isn't, for the whole roster at once. */
export async function getDancerCalendars(): Promise<DancerCalendarRow[]> {
  await requireAdmin();
  const { range } = await activeRange();

  const [users, counts] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        conflictCalendarId: true,
        conflictCalendarName: true,
      },
    }),
    prisma.conflict.groupBy({
      by: ["userId"],
      where: {
        sourceGoogleEventId: { not: null },
        startDateTime: { gte: range.start, lt: range.end },
      },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
  ]);

  const byUser = new Map(counts.map((c) => [c.userId, c]));
  return users.map((u) => ({
    userId: u.id,
    name: u.name ?? u.email,
    email: u.email,
    calendarId: u.conflictCalendarId,
    calendarName: u.conflictCalendarName,
    conflictsInTerm: byUser.get(u.id)?._count._all ?? 0,
    lastSyncedIso: byUser.get(u.id)?._max.updatedAt?.toISOString() ?? null,
  }));
}

/** Syncs the whole term for every dancer who has a calendar linked.
 *
 * Setting up a term is one button, not forty. Failures are collected rather
 * than thrown: one dancer having revoked access must not stop the other
 * thirty-nine from importing. */
export async function syncAllDancerCalendars(): Promise<{
  synced: number;
  added: number;
  failures: { name: string; reason: string }[];
}> {
  await requireAdmin();
  const rows = await prisma.user.findMany({
    where: { conflictCalendarId: { not: null } },
    select: { id: true, name: true, email: true },
  });

  let synced = 0;
  let added = 0;
  const failures: { name: string; reason: string }[] = [];

  for (const person of rows) {
    try {
      const result = await syncConflictCalendar("", 0, {
        userId: person.id,
        wholeTerm: true,
      });
      added += result.added;
      synced++;
    } catch (e) {
      failures.push({
        name: person.name ?? person.email,
        reason: e instanceof Error ? e.message : "Sync failed",
      });
    }
  }

  revalidatePath("/admin/dancer-calendars");
  revalidatePath("/admin/conflicts");
  return { synced, added, failures };
}

export interface ConflictSyncResult {
  added: number;
  updated: number;
  removed: number;
  calendarName: string;
}

/** Pulls conflicts in from the person's chosen conflict calendar.
 *
 * `weeks` covers a whole term in one go — the point of a dedicated conflict
 * calendar is that you keep it current and the app follows, so re-syncing has
 * to be cheap to do and safe to repeat. Only rows a previous sync created are
 * touched: conflicts typed into the app directly have no source id and are
 * left alone, and an event deleted in Google disappears here next sync. */
export async function syncConflictCalendar(
  rangeStartIso: string,
  weeks: number,
  options: { userId?: string; wholeTerm?: boolean } = {},
): Promise<ConflictSyncResult> {
  // An AD can run this for somebody else so a dancer doesn't have to go and
  // do it themselves when their calendar changes. Anyone else only ever acts
  // on their own conflicts.
  const actor = await requireUser();
  const targetId = options.userId ?? actor.id;
  if (targetId !== actor.id) await requireAdmin();

  const me = await prisma.user.findUniqueOrThrow({
    where: { id: targetId },
    select: { conflictCalendarId: true, conflictCalendarName: true },
  });

  // Falling back to "primary" keeps the button working for anyone who hasn't
  // picked a calendar yet, which is how it behaved before this existed.
  const calendarId = me.conflictCalendarId ?? "primary";

  // A term covers the season the AD actually defined, and reaches backwards
  // as well as forwards — the week-count version could only ever look ahead.
  let rangeStart: Date;
  let rangeEnd: Date;
  if (options.wholeTerm) {
    const { range } = await activeRange();
    rangeStart = range.start;
    rangeEnd = range.end;
  } else {
    rangeStart = clampToSupportedRange(new Date(rangeStartIso));
    rangeEnd = addDays(rangeStart, weeks * 7);
  }

  // Read with whoever is asking.
  //
  // When a dancer syncs their own calendar it's their token, as before. When
  // the AD syncs on someone's behalf it's the AD's — which is the only thing
  // that can work, because the team's arrangement is that everyone shares
  // their PADT conflict calendar with the club account. Using the dancer's
  // token there would require them to have signed in and granted calendar
  // access, which is exactly the step the AD is doing this to avoid.
  const calendar = await getGoogleCalendarClientForUser(actor.id);
  const events = (
    await listAllEvents(calendar, calendarId, rangeStart, rangeEnd)
  ).filter(
    (event) =>
      event.id &&
      event.status !== "cancelled" &&
      event.start?.dateTime &&
      event.end?.dateTime,
  );

  const existing = await prisma.conflict.findMany({
    where: {
      userId: targetId,
      sourceGoogleEventId: { not: null },
      startDateTime: { gte: rangeStart, lt: rangeEnd },
    },
    select: {
      id: true,
      sourceGoogleEventId: true,
      startDateTime: true,
      endDateTime: true,
      title: true,
    },
  });
  const existingByEventId = new Map(
    existing.map((row) => [row.sourceGoogleEventId!, row]),
  );

  let added = 0;
  let updated = 0;

  for (const event of events) {
    const start = new Date(event.start!.dateTime!);
    const end = new Date(event.end!.dateTime!);
    // The event's own title is the whole point — it's what the AD reads when
    // deciding whether a conflict is excused.
    const title = event.summary ?? null;
    const row = existingByEventId.get(event.id!);

    if (row) {
      existingByEventId.delete(event.id!);
      const unchanged =
        row.startDateTime.getTime() === start.getTime() &&
        row.endDateTime.getTime() === end.getTime() &&
        row.title === title;
      if (!unchanged) {
        await prisma.conflict.update({
          where: { id: row.id },
          data: {
            startDateTime: start,
            endDateTime: end,
            title,
            weekOf: startOfWeek(start),
          },
        });
        updated++;
      }
    } else {
      await prisma.conflict.create({
        data: {
          userId: targetId,
          weekOf: startOfWeek(start),
          startDateTime: start,
          endDateTime: end,
          title,
          sourceGoogleEventId: event.id,
        },
      });
      added++;
    }
  }

  const staleIds = Array.from(existingByEventId.values()).map((r) => r.id);
  if (staleIds.length > 0) {
    await prisma.conflict.deleteMany({ where: { id: { in: staleIds } } });
  }

  revalidatePath("/conflicts");
  revalidatePath("/admin/conflicts");
  return {
    added,
    updated,
    removed: staleIds.length,
    calendarName: me.conflictCalendarName ?? "your main calendar",
  };
}
