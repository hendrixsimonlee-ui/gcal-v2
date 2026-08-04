import { prisma } from "@/lib/prisma";
import { startOfWeek } from "@/lib/dates";
import {
  isChronicallyAbsent,
  isPresent,
  isUnexcused,
  summarizePerson,
  summarizePractice,
  type AttendanceStatus,
  type PracticeAttendanceSummary,
} from "@/lib/attendance";
import {
  APP_TIME_ZONE,
  appDateKey,
  zonedParts,
  zonedTimeToInstant,
} from "@/lib/timezone";

/** One person's outcome at one practice, as stored. Attendance used to be
 * derived on every read from the person's conflicts; now the check-in decides
 * it and the row is the record, so these helpers just read it back. */
type StoredRecord = {
  status: AttendanceStatus;
  minutesLate?: number | null;
};

export interface CastAttendanceRow {
  userId: string;
  name: string;
  role: "DANCER" | "CHOREOGRAPHER";
  /** Null until they check in or somebody records an outcome for them. */
  status: AttendanceStatus | null;
  minutesLate: number | null;
  checkedInAt: Date | null;
  isOverride: boolean;
}

export interface PracticeAttendance {
  practiceId: string;
  danceId: string;
  danceName: string;
  spaceName: string | null;
  startDateTime: Date;
  endDateTime: Date;
  isMarked: boolean;
  /** Set once the choreographer (or an admin) has signed the record off. */
  submittedAt: Date | null;
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
  attendanceSubmittedAt: Date | null;
  attendance: {
    userId: string;
    status: AttendanceStatus;
    minutesLate: number | null;
    checkedInAt: Date | null;
    isOverride: boolean;
  }[];
};

function buildPracticeAttendance(
  practice: PracticeWithRelations,
): PracticeAttendance {
  const byUser = new Map(practice.attendance.map((a) => [a.userId, a]));

  const rows: CastAttendanceRow[] = practice.dance.memberships.map((m) => {
    const record = byUser.get(m.userId);
    return {
      userId: m.userId,
      name: m.user.name ?? m.user.email,
      role: m.role,
      status: record?.status ?? null,
      minutesLate: record?.minutesLate ?? null,
      checkedInAt: record?.checkedInAt ?? null,
      isOverride: record?.isOverride ?? false,
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
    submittedAt: practice.attendanceSubmittedAt,
    rows,
    summary: summarizePractice(
      rows.map((r) => ({ status: r.status, minutesLate: r.minutesLate })),
    ),
  };
}

const practiceInclude = {
  dance: { include: { memberships: { include: { user: true } } } },
  space: true,
  attendance: true,
} as const;

/** Every practice that has already happened, with attendance classified.
 * `danceIds` narrows it to a choreographer's own dances; omit for the AD view. */
export async function getPastPracticesWithAttendance(
  danceIds?: string[],
  includeArchived = false,
): Promise<PracticeAttendance[]> {
  const practices = await prisma.practice.findMany({
    where: {
      status: "CONFIRMED",
      endDateTime: { lte: new Date() },
      // Archived dances drop out of the day-to-day rollups so a finished
      // piece stops cluttering them. Their rows are never deleted, and
      // `includeArchived` brings them back for anyone looking up history.
      ...(includeArchived ? {} : { dance: { archivedAt: null } }),
      ...(danceIds ? { danceId: { in: danceIds } } : {}),
    },
    include: practiceInclude,
    orderBy: { startDateTime: "desc" },
  });

  return practices.map(buildPracticeAttendance);
}

export async function getPracticeAttendance(
  practiceId: string,
): Promise<PracticeAttendance> {
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    include: practiceInclude,
  });
  return buildPracticeAttendance(practice);
}

export interface PersonDanceAttendance {
  danceId: string;
  danceName: string;
  isArchived: boolean;
  entries: {
    practiceId: string;
    startDateTime: Date;
    spaceName: string | null;
    status: AttendanceStatus;
    minutesLate: number | null;
    checkedInAt: Date | null;
  }[];
  presentCount: number;
  excusedAbsences: number;
  unexcusedAbsences: number;
  totalMinutesLate: number;
  attendanceRate: number;
  isFlagged: boolean;
}

/** One person's attendance history, grouped per dance (matching the
 * "organized by dance" structure used across the personal screens). */
export async function getPersonAttendance(
  userId: string,
  threshold: number,
  windowSize: number,
  includeArchived = false,
): Promise<PersonDanceAttendance[]> {
  const memberships = await prisma.danceMembership.findMany({
    where: { userId, ...(includeArchived ? {} : { dance: { archivedAt: null } }) },
    include: { dance: true },
    orderBy: { dance: { name: "asc" } },
  });

  const practices = await getPastPracticesWithAttendance(
    memberships.map((m) => m.danceId),
    includeArchived,
  );

  const byDance = new Map<string, PersonDanceAttendance>();
  for (const membership of memberships) {
    if (byDance.has(membership.danceId)) continue;
    byDance.set(membership.danceId, {
      danceId: membership.danceId,
      danceName: membership.dance.name,
      isArchived: membership.dance.archivedAt !== null,
      entries: [],
      presentCount: 0,
      excusedAbsences: 0,
      unexcusedAbsences: 0,
      totalMinutesLate: 0,
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
    if (!row || row.status === null) continue;
    group.entries.push({
      practiceId: practice.practiceId,
      startDateTime: practice.startDateTime,
      spaceName: practice.spaceName,
      status: row.status,
      minutesLate: row.minutesLate,
      checkedInAt: row.checkedInAt,
    });
  }

  for (const group of byDance.values()) {
    const summary = summarizePerson(userId, group.entries);
    group.presentCount = summary.presentCount;
    group.excusedAbsences = summary.excusedAbsences;
    group.unexcusedAbsences = summary.unexcusedAbsences;
    group.attendanceRate = summary.attendanceRate;
    group.totalMinutesLate = summary.totalMinutesLate;
    group.isFlagged = isChronicallyAbsent(
      group.entries.map((e) => e.status),
      threshold,
      windowSize,
    );
  }

  return Array.from(byDance.values());
}

export interface PersonDanceCell {
  danceId: string;
  danceName: string;
  practicesMarked: number;
  present: number;
  late: number;
  excused: number;
  unexcused: number;
  minutesLate: number;
  isFlagged: boolean;
}

export interface PersonRollup {
  userId: string;
  name: string;
  totalPractices: number;
  totalPresent: number;
  totalLate: number;
  totalExcused: number;
  totalUnexcused: number;
  totalMinutesLate: number;
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

  // userId -> danceId -> records (newest first; practices come back desc)
  const byPerson = new Map<
    string,
    { name: string; perDance: Map<string, { danceName: string; records: StoredRecord[] }> }
  >();

  for (const practice of practices) {
    for (const row of practice.rows) {
      if (row.status === null) continue;
      if (!byPerson.has(row.userId)) {
        byPerson.set(row.userId, { name: row.name, perDance: new Map() });
      }
      const person = byPerson.get(row.userId)!;
      if (!person.perDance.has(practice.danceId)) {
        person.perDance.set(practice.danceId, {
          danceName: practice.danceName,
          records: [],
        });
      }
      person.perDance.get(practice.danceId)!.records.push({
        status: row.status,
        minutesLate: row.minutesLate,
      });
    }
  }

  const rollups: PersonRollup[] = [];
  for (const [userId, { name, perDance }] of byPerson) {
    const cells: PersonDanceCell[] = [];
    for (const [danceId, { danceName, records }] of perDance) {
      const s = summarizePerson(userId, records);
      cells.push({
        danceId,
        danceName,
        practicesMarked: records.length,
        present: s.presentCount,
        late: s.lateCount,
        excused: s.excusedAbsences,
        unexcused: s.unexcusedAbsences,
        minutesLate: s.totalMinutesLate,
        isFlagged: isChronicallyAbsent(
          records.map((r) => r.status),
          threshold,
          windowSize,
        ),
      });
    }
    cells.sort((a, b) => b.unexcused - a.unexcused || a.danceName.localeCompare(b.danceName));

    const allRecords = cells.flatMap((c) => perDance.get(c.danceId)!.records);
    const overall = summarizePerson(userId, allRecords);
    rollups.push({
      userId,
      name,
      totalPractices: allRecords.length,
      totalPresent: overall.presentCount,
      totalLate: overall.lateCount,
      totalExcused: overall.excusedAbsences,
      totalUnexcused: overall.unexcusedAbsences,
      totalMinutesLate: overall.totalMinutesLate,
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
}

/** Flat, newest-first list of every unexcused absence. */
export async function getUnexcusedAbsences(): Promise<UnexcusedAbsenceRow[]> {
  const practices = await getPastPracticesWithAttendance();
  const rows: UnexcusedAbsenceRow[] = [];
  for (const practice of practices) {
    for (const row of practice.rows) {
      if (row.status === null || !isUnexcused(row.status)) continue;
      rows.push({
        userId: row.userId,
        name: row.name,
        danceId: practice.danceId,
        danceName: practice.danceName,
        practiceId: practice.practiceId,
        startDateTime: practice.startDateTime,
      });
    }
  }
  return rows;
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
      if (row.status === null || isPresent(row.status)) continue;
      if (!week.absentNames.includes(row.name)) week.absentNames.push(row.name);
      if (isUnexcused(row.status) && !week.unexcusedNames.includes(row.name)) {
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
    const day = zonedParts(practice.startDateTime).weekday;
    for (const row of practice.rows) {
      if (row.status === null || !relevant.has(row.userId)) continue;
      if (!tally.has(row.userId)) tally.set(row.userId, new Map());
      const perDay = tally.get(row.userId)!;
      const [unexcused, total] = perDay.get(day) ?? [0, 0];
      perDay.set(day, [
        unexcused + (isUnexcused(row.status) ? 1 : 0),
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
export interface OverallAbsenceFlag {
  userId: string;
  name: string;
  unexcusedInWindow: number;
  windowSize: number;
  /** Which dances those recent unexcused absences came from. */
  danceNames: string[];
}

/** Chronic absence measured across everything a person is in, rather than
 * per dance. Catches the dancer who misses one practice of each piece —
 * invisible per-dance, but a real pattern in aggregate. */
export async function getOverallAbsenceFlags(
  threshold: number,
  windowSize: number,
): Promise<OverallAbsenceFlag[]> {
  const practices = await getPastPracticesWithAttendance();

  // userId -> their marked practices, newest first (practices arrive desc)
  const byPerson = new Map<
    string,
    { name: string; entries: { status: AttendanceStatus; danceName: string }[] }
  >();

  for (const practice of practices) {
    for (const row of practice.rows) {
      if (row.status === null) continue;
      if (!byPerson.has(row.userId)) {
        byPerson.set(row.userId, { name: row.name, entries: [] });
      }
      byPerson.get(row.userId)!.entries.push({
        status: row.status,
        danceName: practice.danceName,
      });
    }
  }

  const flags: OverallAbsenceFlag[] = [];
  for (const [userId, { name, entries }] of byPerson) {
    const window = entries.slice(0, windowSize);
    const unexcused = window.filter((e) => isUnexcused(e.status));
    if (unexcused.length < threshold) continue;
    flags.push({
      userId,
      name,
      unexcusedInWindow: unexcused.length,
      windowSize,
      danceNames: Array.from(new Set(unexcused.map((e) => e.danceName))).sort(),
    });
  }

  return flags.sort((a, b) => b.unexcusedInWindow - a.unexcusedInWindow);
}

export async function getChronicAbsenceFlags(
  threshold: number,
  windowSize: number,
): Promise<ChronicAbsenceFlag[]> {
  const practices = await getPastPracticesWithAttendance();

  // userId -> danceId -> statuses (newest first, since practices sort desc)
  const byPersonDance = new Map<string, Map<string, AttendanceStatus[]>>();
  const names = new Map<string, string>();
  const danceNames = new Map<string, string>();

  for (const practice of practices) {
    danceNames.set(practice.danceId, practice.danceName);
    for (const row of practice.rows) {
      if (row.status === null) continue;
      names.set(row.userId, row.name);
      if (!byPersonDance.has(row.userId)) byPersonDance.set(row.userId, new Map());
      const perDance = byPersonDance.get(row.userId)!;
      if (!perDance.has(practice.danceId)) perDance.set(practice.danceId, []);
      perDance.get(practice.danceId)!.push(row.status);
    }
  }

  const flags: ChronicAbsenceFlag[] = [];
  for (const [userId, perDance] of byPersonDance) {
    for (const [danceId, statuses] of perDance) {
      if (!isChronicallyAbsent(statuses, threshold, windowSize)) continue;
      const window = statuses.slice(0, windowSize);
      flags.push({
        userId,
        name: names.get(userId) ?? userId,
        danceId,
        danceName: danceNames.get(danceId) ?? danceId,
        unexcusedInWindow: window.filter(isUnexcused).length,
        windowSize,
      });
    }
  }

  return flags.sort((a, b) => b.unexcusedInWindow - a.unexcusedInWindow);
}

export interface MonthKey {
  /** "2026-09" — sortable, and the label is derived from it. */
  key: string;
  label: string;
}

export interface DanceLateness {
  danceId: string;
  danceName: string;
  /** month key -> minutes late */
  byMonth: Map<string, number>;
  total: number;
}

export interface PersonLateness {
  userId: string;
  name: string;
  dances: DanceLateness[];
  byMonth: Map<string, number>;
  total: number;
}

export interface SemesterLateness {
  /** "2026-fall" — sortable within a year once the season is ordered. */
  key: string;
  label: string;
  months: MonthKey[];
  people: PersonLateness[];
  total: number;
}

const monthLabelFormatter = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, month: "short" });

function monthKeyOf(date: Date): string {
  return appDateKey(date).slice(0, 7);
}

/** Which semester a practice falls in.
 *
 * Derived from the date rather than the dance's `season` text, so it stays
 * right even when a piece is labelled loosely or runs across the boundary.
 * Spring is Jan–May, Summer Jun–Jul, Fall Aug–Dec. */
function semesterOf(date: Date): { key: string; label: string } {
  const parts = zonedParts(date);
  const year = parts.year;
  const month = parts.month - 1;
  const season = month <= 4 ? "spring" : month <= 6 ? "summer" : "fall";
  const order = season === "spring" ? "1" : season === "summer" ? "2" : "3";
  return {
    key: `${year}-${order}-${season}`,
    label: `${season[0].toUpperCase()}${season.slice(1)} ${year}`,
  };
}

/** Minutes late, broken out per dance, summed per month and per semester.
 *
 * Minutes are the only number here on purpose — the AD's question is "how
 * many minutes late was this person", and counting occasions alongside it
 * just crowds the answer.
 *
 * Archived dances are included: a piece finishing its run doesn't erase that
 * someone was late to it, and this screen exists to settle exactly that kind
 * of question. */
export async function getLatenessBySemester(
  monthsBack = 18,
): Promise<SemesterLateness[]> {
  // First of the month, N months back, at Eastern midnight.
  const now = zonedParts(new Date());
  const since = zonedTimeToInstant(now.year, now.month - monthsBack, 1, 0, 0, 0);

  const records = await prisma.attendance.findMany({
    where: {
      minutesLate: { gt: 0 },
      practice: { startDateTime: { gte: since } },
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      practice: {
        select: {
          startDateTime: true,
          danceId: true,
          dance: { select: { name: true } },
        },
      },
    },
  });

  // semesterKey -> { label, months, personId -> person }
  const semesters = new Map<
    string,
    {
      label: string;
      months: Set<string>;
      people: Map<string, PersonLateness & { danceMap: Map<string, DanceLateness> }>;
    }
  >();

  for (const record of records) {
    const minutes = record.minutesLate ?? 0;
    if (minutes <= 0) continue;

    const when = record.practice.startDateTime;
    const semester = semesterOf(when);
    const month = monthKeyOf(when);

    if (!semesters.has(semester.key)) {
      semesters.set(semester.key, {
        label: semester.label,
        months: new Set(),
        people: new Map(),
      });
    }
    const bucket = semesters.get(semester.key)!;
    bucket.months.add(month);

    if (!bucket.people.has(record.userId)) {
      bucket.people.set(record.userId, {
        userId: record.userId,
        name: record.user.name ?? record.user.email,
        dances: [],
        danceMap: new Map(),
        byMonth: new Map(),
        total: 0,
      });
    }
    const person = bucket.people.get(record.userId)!;

    if (!person.danceMap.has(record.practice.danceId)) {
      person.danceMap.set(record.practice.danceId, {
        danceId: record.practice.danceId,
        danceName: record.practice.dance.name,
        byMonth: new Map(),
        total: 0,
      });
    }
    const dance = person.danceMap.get(record.practice.danceId)!;

    dance.byMonth.set(month, (dance.byMonth.get(month) ?? 0) + minutes);
    dance.total += minutes;
    person.byMonth.set(month, (person.byMonth.get(month) ?? 0) + minutes);
    person.total += minutes;
  }

  return Array.from(semesters.entries())
    // Newest semester first — that's the one anyone is asking about.
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, bucket]) => {
      const people = Array.from(bucket.people.values())
        .map((person) => ({
          userId: person.userId,
          name: person.name,
          byMonth: person.byMonth,
          total: person.total,
          dances: Array.from(person.danceMap.values()).sort(
            (a, b) => b.total - a.total || a.danceName.localeCompare(b.danceName),
          ),
        }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

      return {
        key,
        label: bucket.label,
        months: Array.from(bucket.months)
          .sort()
          .map((m) => ({
            key: m,
            label: monthLabelFormatter.format(new Date(`${m}-01T12:00:00`)),
          })),
        people,
        total: people.reduce((sum, p) => sum + p.total, 0),
      };
    });
}

export interface UpcomingPractice {
  practiceId: string;
  danceId: string;
  danceName: string;
  spaceName: string | null;
  startDateTime: Date;
  expectedCount: number;
  excusedCount: number;
  lateCount: number;
}

/** Confirmed practices still to come, with a headline of who's expected.
 *
 * The choreographer's whole reason to look before a practice is "who am I
 * getting", and until this existed that view was only reachable after the
 * practice had already happened. */
export async function getUpcomingPracticesForDances(
  danceIds: string[],
): Promise<UpcomingPractice[]> {
  if (danceIds.length === 0) return [];

  const practices = await prisma.practice.findMany({
    where: {
      status: "CONFIRMED",
      danceId: { in: danceIds },
      endDateTime: { gt: new Date() },
      dance: { archivedAt: null },
    },
    include: {
      space: { select: { name: true } },
      dance: {
        select: { name: true, memberships: { select: { userId: true } } },
      },
      plannedArrivals: { select: { userId: true } },
    },
    orderBy: { startDateTime: "asc" },
  });
  if (practices.length === 0) return [];

  const castIds = Array.from(
    new Set(practices.flatMap((p) => p.dance.memberships.map((m) => m.userId))),
  );
  const conflicts = await prisma.conflict.findMany({
    where: { userId: { in: castIds }, status: "EXCUSED" },
    select: { userId: true, startDateTime: true, endDateTime: true },
  });

  return practices.map((practice) => {
    const late = new Set(practice.plannedArrivals.map((a) => a.userId));
    const excused = new Set(
      conflicts
        .filter(
          (c) =>
            c.startDateTime < practice.endDateTime &&
            c.endDateTime > practice.startDateTime,
        )
        .map((c) => c.userId),
    );
    const cast = practice.dance.memberships.map((m) => m.userId);

    return {
      practiceId: practice.id,
      danceId: practice.danceId,
      danceName: practice.dance.name,
      spaceName: practice.space?.name ?? null,
      startDateTime: practice.startDateTime,
      expectedCount: cast.filter((id) => !excused.has(id) && !late.has(id)).length,
      excusedCount: cast.filter((id) => excused.has(id) && !late.has(id)).length,
      lateCount: late.size,
    };
  });
}
