import { prisma } from "@/lib/prisma";
import { startOfWeek } from "@/lib/dates";
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

export interface PersonDanceCell {
  danceId: string;
  danceName: string;
  practicesMarked: number;
  present: number;
  excused: number;
  unexcused: number;
  isFlagged: boolean;
}

export interface PersonRollup {
  userId: string;
  name: string;
  totalPractices: number;
  totalPresent: number;
  totalExcused: number;
  totalUnexcused: number;
  attendanceRate: number;
  perDance: PersonDanceCell[];
}

/** Everyone, with their record broken out per dance — the "how many has this
 * person missed, and for which piece" view. */
export async function getPersonRollups(
  threshold: number,
  windowSize: number,
): Promise<PersonRollup[]> {
  const practices = await getPastPracticesWithAttendance();

  // userId -> danceId -> kinds (newest first; practices come back desc)
  const byPerson = new Map<
    string,
    { name: string; perDance: Map<string, { danceName: string; kinds: AbsenceKind[] }> }
  >();

  for (const practice of practices) {
    for (const row of practice.rows) {
      if (row.kind === null) continue;
      if (!byPerson.has(row.userId)) {
        byPerson.set(row.userId, { name: row.name, perDance: new Map() });
      }
      const person = byPerson.get(row.userId)!;
      if (!person.perDance.has(practice.danceId)) {
        person.perDance.set(practice.danceId, {
          danceName: practice.danceName,
          kinds: [],
        });
      }
      person.perDance.get(practice.danceId)!.kinds.push(row.kind);
    }
  }

  const rollups: PersonRollup[] = [];
  for (const [userId, { name, perDance }] of byPerson) {
    const cells: PersonDanceCell[] = [];
    for (const [danceId, { danceName, kinds }] of perDance) {
      const s = summarizePerson(userId, kinds);
      cells.push({
        danceId,
        danceName,
        practicesMarked: kinds.length,
        present: s.presentCount,
        excused: s.excusedAbsences,
        unexcused: s.unexcusedAbsences,
        isFlagged: isChronicallyAbsent(kinds, threshold, windowSize),
      });
    }
    cells.sort((a, b) => b.unexcused - a.unexcused || a.danceName.localeCompare(b.danceName));

    const allKinds = cells.flatMap((c) =>
      perDance.get(c.danceId)!.kinds,
    );
    const overall = summarizePerson(userId, allKinds);
    rollups.push({
      userId,
      name,
      totalPractices: allKinds.length,
      totalPresent: overall.presentCount,
      totalExcused: overall.excusedAbsences,
      totalUnexcused: overall.unexcusedAbsences,
      attendanceRate: overall.attendanceRate,
      perDance: cells,
    });
  }

  // Worst offenders first — that's what this view is for.
  return rollups.sort(
    (a, b) =>
      b.totalUnexcused - a.totalUnexcused ||
      a.attendanceRate - b.attendanceRate ||
      a.name.localeCompare(b.name),
  );
}

export interface UnexcusedAbsenceRow {
  userId: string;
  name: string;
  danceId: string;
  danceName: string;
  practiceId: string;
  startDateTime: Date;
  kind: AbsenceKind;
}

/** Flat, newest-first list of every unexcused absence. */
export async function getUnexcusedAbsences(): Promise<UnexcusedAbsenceRow[]> {
  const practices = await getPastPracticesWithAttendance();
  const rows: UnexcusedAbsenceRow[] = [];
  for (const practice of practices) {
    for (const row of practice.rows) {
      if (row.kind === null || !isUnexcusedKind(row.kind)) continue;
      rows.push({
        userId: row.userId,
        name: row.name,
        danceId: practice.danceId,
        danceName: practice.danceName,
        practiceId: practice.practiceId,
        startDateTime: practice.startDateTime,
        kind: row.kind,
      });
    }
  }
  return rows;
}

function isUnexcusedKind(kind: AbsenceKind): boolean {
  return kind === "no-show" || kind === "unexcused-conflict";
}

export interface WeeklyDanceRow {
  weekOf: Date;
  practiceCount: number;
  castSize: number;
  absentNames: string[];
  unexcusedNames: string[];
  absentPercent: number;
}

export interface DanceWeeklyRollup {
  danceId: string;
  danceName: string;
  weeks: WeeklyDanceRow[];
}

/** Per dance, week by week: who was missing and how big a chunk of the cast
 * that was — the "are we losing people each week" view. */
export async function getWeeklyRollupByDance(): Promise<DanceWeeklyRollup[]> {
  const practices = await getPastPracticesWithAttendance();

  const byDance = new Map<
    string,
    { danceName: string; weeks: Map<string, WeeklyDanceRow> }
  >();

  for (const practice of practices) {
    if (!practice.isMarked) continue;
    if (!byDance.has(practice.danceId)) {
      byDance.set(practice.danceId, {
        danceName: practice.danceName,
        weeks: new Map(),
      });
    }
    const dance = byDance.get(practice.danceId)!;
    const weekStart = startOfWeek(practice.startDateTime);
    const key = weekStart.toISOString();

    if (!dance.weeks.has(key)) {
      dance.weeks.set(key, {
        weekOf: weekStart,
        practiceCount: 0,
        castSize: practice.rows.length,
        absentNames: [],
        unexcusedNames: [],
        absentPercent: 0,
      });
    }
    const week = dance.weeks.get(key)!;
    week.practiceCount += 1;
    week.castSize = Math.max(week.castSize, practice.rows.length);

    for (const row of practice.rows) {
      if (row.kind === null || row.kind === "present") continue;
      if (!week.absentNames.includes(row.name)) week.absentNames.push(row.name);
      if (isUnexcusedKind(row.kind) && !week.unexcusedNames.includes(row.name)) {
        week.unexcusedNames.push(row.name);
      }
    }
  }

  const result: DanceWeeklyRollup[] = [];
  for (const [danceId, { danceName, weeks }] of byDance) {
    const rows = Array.from(weeks.values())
      .map((w) => ({
        ...w,
        absentPercent:
          w.castSize === 0
            ? 0
            : Math.round((w.absentNames.length / w.castSize) * 100),
      }))
      .sort((a, b) => b.weekOf.getTime() - a.weekOf.getTime());
    result.push({ danceId, danceName, weeks: rows });
  }

  return result.sort((a, b) => a.danceName.localeCompare(b.danceName));
}

/** Minimum marked practices on a given weekday before we'll draw any
 * conclusion about someone's pattern there. */
const MIN_HISTORY_FOR_PATTERN = 2;

/** Per person, per weekday: what fraction of that weekday's practices they
 * missed without an excuse. Feeds the optional historical weighting in slot
 * ranking — only unexcused absences count, so someone who diligently logs
 * real conflicts never gets penalised by it. */
export async function getHistoricalAbsenceRates(
  userIds: string[],
): Promise<Map<string, Map<number, number>>> {
  const practices = await getPastPracticesWithAttendance();
  const relevant = new Set(userIds);

  // userId -> dayOfWeek -> [unexcused, total]
  const tally = new Map<string, Map<number, [number, number]>>();

  for (const practice of practices) {
    const day = practice.startDateTime.getDay();
    for (const row of practice.rows) {
      if (row.kind === null || !relevant.has(row.userId)) continue;
      if (!tally.has(row.userId)) tally.set(row.userId, new Map());
      const perDay = tally.get(row.userId)!;
      const [unexcused, total] = perDay.get(day) ?? [0, 0];
      perDay.set(day, [
        unexcused + (isUnexcusedKind(row.kind) ? 1 : 0),
        total + 1,
      ]);
    }
  }

  const rates = new Map<string, Map<number, number>>();
  for (const [userId, perDay] of tally) {
    const dayRates = new Map<number, number>();
    for (const [day, [unexcused, total]] of perDay) {
      if (total < MIN_HISTORY_FOR_PATTERN) continue;
      dayRates.set(day, unexcused / total);
    }
    if (dayRates.size > 0) rates.set(userId, dayRates);
  }
  return rates;
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
