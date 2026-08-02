import { prisma } from "@/lib/prisma";
import {
  classifyAttendance,
  isChronicallyAbsent,
  summarizePerson,
  summarizePractice,
  type AbsenceKind,
  type ConflictWindow,
  type UnavailabilityWindow,
  type PracticeAttendanceSummary,
} from "@/lib/attendance";

export interface CastAttendanceRow {
  userId: string;
  name: string;
  role: "DANCER" | "CHOREOGRAPHER";
  attended: boolean | null;
  kind: AbsenceKind | null;
}

export interface PracticeAttendance {
  practiceId: string;
  danceId: string;
  danceName: string;
  spaceName: string | null;
  startDateTime: Date;
  endDateTime: Date;
  isMarked: boolean;
  rows: CastAttendanceRow[];
  summary: PracticeAttendanceSummary;
}

type PracticeWithRelations = {
  id: string;
  danceId: string;
  startDateTime: Date;
  endDateTime: Date;
  dance: {
    name: string;
    memberships: {
      userId: string;
      role: "DANCER" | "CHOREOGRAPHER";
      user: { name: string | null; email: string };
    }[];
  };
  space: { name: string } | null;
  attendance: { userId: string; attended: boolean }[];
};

function buildPracticeAttendance(
  practice: PracticeWithRelations,
  conflicts: ConflictWindow[],
  unavailabilities: UnavailabilityWindow[],
): PracticeAttendance {
  const attendedByUser = new Map(
    practice.attendance.map((a) => [a.userId, a.attended]),
  );

  const rows: CastAttendanceRow[] = practice.dance.memberships.map((m) => {
    const attended = attendedByUser.get(m.userId) ?? null;
    return {
      userId: m.userId,
      name: m.user.name ?? m.user.email,
      role: m.role,
      attended,
      kind:
        attended === null
          ? null
          : classifyAttendance(
              m.userId,
              attended,
              practice.startDateTime,
              practice.endDateTime,
              conflicts,
              unavailabilities,
            ),
    };
  });

  return {
    practiceId: practice.id,
    danceId: practice.danceId,
    danceName: practice.dance.name,
    spaceName: practice.space?.name ?? null,
    startDateTime: practice.startDateTime,
    endDateTime: practice.endDateTime,
    isMarked: practice.attendance.length > 0,
    rows,
    summary: summarizePractice(rows.map((r) => ({ kind: r.kind }))),
  };
}

const practiceInclude = {
  dance: { include: { memberships: { include: { user: true } } } },
  space: true,
  attendance: true,
} as const;

async function loadConflictContext(userIds: string[]) {
  const [conflicts, unavailabilities] = await Promise.all([
    prisma.conflict.findMany({
      where: { userId: { in: userIds } },
      include: { category: true },
    }),
    prisma.unavailability.findMany({ where: { userId: { in: userIds } } }),
  ]);

  return {
    conflicts: conflicts.map((c) => ({
      userId: c.userId,
      startDateTime: c.startDateTime,
      endDateTime: c.endDateTime,
      isExcused: c.category?.isExcused ?? false,
    })),
    unavailabilities: unavailabilities.map((u) => ({
      userId: u.userId,
      startDate: u.startDate,
      endDate: u.endDate,
    })),
  };
}

/** Every practice that has already happened, with attendance classified.
 * `danceIds` narrows it to a choreographer's own dances; omit for the AD view. */
export async function getPastPracticesWithAttendance(
  danceIds?: string[],
): Promise<PracticeAttendance[]> {
  const practices = await prisma.practice.findMany({
    where: {
      status: "CONFIRMED",
      endDateTime: { lte: new Date() },
      ...(danceIds ? { danceId: { in: danceIds } } : {}),
    },
    include: practiceInclude,
    orderBy: { startDateTime: "desc" },
  });

  const userIds = Array.from(
    new Set(practices.flatMap((p) => p.dance.memberships.map((m) => m.userId))),
  );
  const { conflicts, unavailabilities } = await loadConflictContext(userIds);

  return practices.map((p) =>
    buildPracticeAttendance(p, conflicts, unavailabilities),
  );
}

export async function getPracticeAttendance(
  practiceId: string,
): Promise<PracticeAttendance> {
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    include: practiceInclude,
  });
  const { conflicts, unavailabilities } = await loadConflictContext(
    practice.dance.memberships.map((m) => m.userId),
  );
  return buildPracticeAttendance(practice, conflicts, unavailabilities);
}

export interface PersonDanceAttendance {
  danceId: string;
  danceName: string;
  entries: {
    practiceId: string;
    startDateTime: Date;
    kind: AbsenceKind;
  }[];
  presentCount: number;
  excusedAbsences: number;
  unexcusedAbsences: number;
  attendanceRate: number;
  isFlagged: boolean;
}

/** One person's attendance history, grouped per dance (matching the
 * "organized by dance" structure used across the personal screens). */
export async function getPersonAttendance(
  userId: string,
  threshold: number,
  windowSize: number,
): Promise<PersonDanceAttendance[]> {
  const memberships = await prisma.danceMembership.findMany({
    where: { userId },
    include: { dance: true },
    orderBy: { dance: { name: "asc" } },
  });

  const practices = await getPastPracticesWithAttendance(
    memberships.map((m) => m.danceId),
  );

  const byDance = new Map<string, PersonDanceAttendance>();
  for (const membership of memberships) {
    if (byDance.has(membership.danceId)) continue;
    byDance.set(membership.danceId, {
      danceId: membership.danceId,
      danceName: membership.dance.name,
      entries: [],
      presentCount: 0,
      excusedAbsences: 0,
      unexcusedAbsences: 0,
      attendanceRate: 100,
      isFlagged: false,
    });
  }

  // practices come back newest-first, which is what the chronic-absence
  // window expects.
  for (const practice of practices) {
    const group = byDance.get(practice.danceId);
    if (!group) continue;
    const row = practice.rows.find((r) => r.userId === userId);
    if (!row || row.kind === null) continue;
    group.entries.push({
      practiceId: practice.practiceId,
      startDateTime: practice.startDateTime,
      kind: row.kind,
    });
  }

  for (const group of byDance.values()) {
    const kinds = group.entries.map((e) => e.kind);
    const summary = summarizePerson(userId, kinds);
    group.presentCount = summary.presentCount;
    group.excusedAbsences = summary.excusedAbsences;
    group.unexcusedAbsences = summary.unexcusedAbsences;
    group.attendanceRate = summary.attendanceRate;
    group.isFlagged = isChronicallyAbsent(kinds, threshold, windowSize);
  }

  return Array.from(byDance.values());
}

export interface ChronicAbsenceFlag {
  userId: string;
  name: string;
  danceId: string;
  danceName: string;
  unexcusedInWindow: number;
  windowSize: number;
}

/** Everyone currently over the unexcused-absence threshold, per dance. */
export async function getChronicAbsenceFlags(
  threshold: number,
  windowSize: number,
): Promise<ChronicAbsenceFlag[]> {
  const practices = await getPastPracticesWithAttendance();

  // userId -> danceId -> kinds (newest first, since practices are sorted desc)
  const byPersonDance = new Map<string, Map<string, AbsenceKind[]>>();
  const names = new Map<string, string>();
  const danceNames = new Map<string, string>();

  for (const practice of practices) {
    danceNames.set(practice.danceId, practice.danceName);
    for (const row of practice.rows) {
      if (row.kind === null) continue;
      names.set(row.userId, row.name);
      if (!byPersonDance.has(row.userId)) byPersonDance.set(row.userId, new Map());
      const perDance = byPersonDance.get(row.userId)!;
      if (!perDance.has(practice.danceId)) perDance.set(practice.danceId, []);
      perDance.get(practice.danceId)!.push(row.kind);
    }
  }

  const flags: ChronicAbsenceFlag[] = [];
  for (const [userId, perDance] of byPersonDance) {
    for (const [danceId, kinds] of perDance) {
      if (!isChronicallyAbsent(kinds, threshold, windowSize)) continue;
      const window = kinds.slice(0, windowSize);
      flags.push({
        userId,
        name: names.get(userId) ?? userId,
        danceId,
        danceName: danceNames.get(danceId) ?? danceId,
        unexcusedInWindow: window.filter(
          (k) => k === "no-show" || k === "unexcused-conflict",
        ).length,
        windowSize,
      });
    }
  }

  return flags.sort((a, b) => b.unexcusedInWindow - a.unexcusedInWindow);
}
