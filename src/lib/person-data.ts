import { prisma } from "@/lib/prisma";
import {
  isUnexcused,
  summarizePerson,
  type AttendanceStatus,
} from "@/lib/attendance";
import { APP_TIME_ZONE, appDateKey } from "@/lib/timezone";

export interface PersonPracticeRow {
  practiceId: string;
  danceId: string;
  danceName: string;
  danceArchived: boolean;
  spaceName: string | null;
  startDateTime: Date;
  status: AttendanceStatus | null;
  minutesLate: number | null;
  checkedInAt: Date | null;
  isOverride: boolean;
  submitted: boolean;
}

export interface PersonConflictRow {
  id: string;
  title: string | null;
  startDateTime: Date;
  endDateTime: Date;
  status: "NOT_REVIEWED" | "EXCUSED" | "UNEXCUSED";
  fromGoogle: boolean;
}

export interface PersonNoteRow {
  id: string;
  body: string;
  authorName: string;
  danceName: string;
  practiceId: string;
  startDateTime: Date;
}

export interface PersonDossier {
  userId: string;
  name: string;
  email: string;
  isAdmin: boolean;
  conflictCalendarName: string | null;
  dances: { danceId: string; danceName: string; role: string; archived: boolean }[];
  practices: PersonPracticeRow[];
  conflicts: PersonConflictRow[];
  away: { id: string; startDate: Date; endDate: Date; reason: string | null }[];
  notes: PersonNoteRow[];
  totals: {
    recorded: number;
    present: number;
    late: number;
    excused: number;
    unexcused: number;
    minutesLate: number;
    attendanceRate: number;
  };
  /** Minutes late per month, newest first — the shape of the pattern. */
  lateByMonth: { label: string; minutes: number }[];
}

const monthLabel = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  year: "numeric",
});

/** Everything the app knows about one person, in one place.
 *
 * This exists for the conversation that starts "I was definitely there" —
 * without it, answering means knowing which dance, finding the practice, and
 * opening it. Archived pieces are included; a finished piece is exactly the
 * thing someone is looking back at. */
export async function getPersonDossier(
  userId: string,
): Promise<PersonDossier | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: { include: { dance: true }, orderBy: { dance: { name: "asc" } } },
      unavailabilities: { orderBy: { startDate: "desc" }, take: 20 },
    },
  });
  if (!user) return null;

  const [attendance, conflicts, notes] = await Promise.all([
    prisma.attendance.findMany({
      where: { userId },
      include: {
        practice: {
          include: { dance: true, space: { select: { name: true } } },
        },
      },
    }),
    prisma.conflict.findMany({
      where: { userId },
      orderBy: { startDateTime: "desc" },
      take: 60,
    }),
    prisma.practiceNote.findMany({
      where: { subjectUserId: userId },
      include: {
        author: { select: { name: true, email: true } },
        practice: { include: { dance: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);

  const practices: PersonPracticeRow[] = attendance
    .map((record) => ({
      practiceId: record.practiceId,
      danceId: record.practice.danceId,
      danceName: record.practice.dance.name,
      danceArchived: record.practice.dance.archivedAt !== null,
      spaceName: record.practice.space?.name ?? null,
      startDateTime: record.practice.startDateTime,
      status: record.status,
      minutesLate: record.minutesLate,
      checkedInAt: record.checkedInAt,
      isOverride: record.isOverride,
      submitted: record.practice.attendanceSubmittedAt !== null,
    }))
    .sort((a, b) => b.startDateTime.getTime() - a.startDateTime.getTime());

  const recorded = practices.filter(
    (p): p is PersonPracticeRow & { status: AttendanceStatus } => p.status !== null,
  );
  const summary = summarizePerson(
    userId,
    recorded.map((p) => ({ status: p.status, minutesLate: p.minutesLate })),
  );

  // Newest month first, so a recent run of lateness is the first thing read.
  const monthly = new Map<string, { label: string; minutes: number }>();
  for (const practice of recorded) {
    if (!practice.minutesLate) continue;
    const key = appDateKey(practice.startDateTime).slice(0, 7);
    const entry = monthly.get(key) ?? {
      label: monthLabel.format(practice.startDateTime),
      minutes: 0,
    };
    entry.minutes += practice.minutesLate;
    monthly.set(key, entry);
  }

  return {
    userId: user.id,
    name: user.name ?? user.email,
    email: user.email,
    isAdmin: user.isAdmin,
    conflictCalendarName: user.conflictCalendarName,
    dances: user.memberships.map((m) => ({
      danceId: m.danceId,
      danceName: m.dance.name,
      role: m.role,
      archived: m.dance.archivedAt !== null,
    })),
    practices,
    conflicts: conflicts.map((c) => ({
      id: c.id,
      title: c.title,
      startDateTime: c.startDateTime,
      endDateTime: c.endDateTime,
      status: c.status,
      fromGoogle: Boolean(c.sourceGoogleEventId),
    })),
    away: user.unavailabilities.map((u) => ({
      id: u.id,
      startDate: u.startDate,
      endDate: u.endDate,
      reason: u.reason,
    })),
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      authorName: n.author.name ?? n.author.email,
      danceName: n.practice.dance.name,
      practiceId: n.practiceId,
      startDateTime: n.practice.startDateTime,
    })),
    totals: {
      recorded: recorded.length,
      present: summary.presentCount,
      late: summary.lateCount,
      excused: summary.excusedAbsences,
      unexcused: recorded.filter((p) => isUnexcused(p.status)).length,
      minutesLate: summary.totalMinutesLate,
      attendanceRate: summary.attendanceRate,
    },
    lateByMonth: Array.from(monthly.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([, value]) => value),
  };
}
