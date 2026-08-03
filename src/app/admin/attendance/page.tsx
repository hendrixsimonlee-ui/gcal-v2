import { Fragment } from "react";
import Link from "next/link";
import { getAttendanceSettings } from "@/lib/actions/attendance";
import {
  getChronicAbsenceFlags,
  getOverallAbsenceFlags,
  getPastPracticesWithAttendance,
  getLatenessBySemester,
  getPersonRollups,
  getUnexcusedAbsences,
  getWeeklyRollupByDance,
} from "@/lib/attendance-data";
import { AttendanceBadge } from "@/components/status-badges";
import { formatWeekLabel } from "@/lib/dates";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

type View = "person" | "lateness" | "unexcused" | "weekly" | "practices";

const VIEWS: { key: View; label: string }[] = [
  { key: "person", label: "By person" },
  { key: "lateness", label: "Lateness by month" },
  { key: "unexcused", label: "Unexcused only" },
  { key: "weekly", label: "By dance, week by week" },
  { key: "practices", label: "Every practice" },
];

export default async function AdminAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: rawView } = await searchParams;
  const view: View = VIEWS.some((v) => v.key === rawView)
    ? (rawView as View)
    : "person";

  const settings = await getAttendanceSettings();
  const [flags, overallFlags] = await Promise.all([
    getChronicAbsenceFlags(
      settings.chronicAbsenceThreshold,
      settings.chronicAbsenceWindow,
    ),
    getOverallAbsenceFlags(
      settings.chronicAbsenceThreshold,
      settings.chronicAbsenceWindow,
    ),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Attendance Review
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Flags trip at {settings.chronicAbsenceThreshold}{" "}
          unexcused absences out of a dancer&rsquo;s last{" "}
          {settings.chronicAbsenceWindow} practices —{" "}
          <Link href="/admin/settings" className="underline">
            change that in Settings
          </Link>
          .
        </p>
      </div>

      {/* Always rendered, even when empty — a dashboard that disappears when
          there's nothing to report just reads as a missing feature. */}
      <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
            <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">
              Letting down a specific dance ({flags.length})
            </h2>
            <p className="mb-2 text-xs text-red-700 dark:text-red-400">
              Counted within one dance, so a choreographer can see who
              keeps missing <em>their</em> rehearsals.
            </p>
            {flags.length === 0 ? (
              <p className="text-sm text-red-800 dark:text-red-300">
                Nobody over the threshold.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {flags.map((flag) => (
                  <li
                    key={`${flag.userId}-${flag.danceId}`}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm text-red-800 dark:text-red-300"
                  >
                    <span className="font-medium">{flag.name}</span>
                    <span>{flag.danceName}</span>
                    <span className="text-xs">
                      {flag.unexcusedInWindow} of last {flag.windowSize}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
            <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Slipping overall ({overallFlags.length})
            </h2>
            <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">
              Counted across everything they&rsquo;re in — catches someone
              missing one practice of each piece, which no single dance sees.
            </p>
            {overallFlags.length === 0 ? (
              <p className="text-sm text-amber-800 dark:text-amber-300">
                Nobody over the threshold.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {overallFlags.map((flag) => (
                  <li
                    key={flag.userId}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-800 dark:text-amber-300"
                  >
                    <span className="font-medium">{flag.name}</span>
                    <span className="text-xs">
                      {flag.danceNames.join(", ")}
                    </span>
                    <span className="text-xs">
                      {flag.unexcusedInWindow} of last {flag.windowSize}
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-zinc-200 pb-2 dark:border-zinc-800">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/admin/attendance?view=${v.key}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              v.key === view
                ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {view === "person" && (
        <ByPersonView
          threshold={settings.chronicAbsenceThreshold}
          windowSize={settings.chronicAbsenceWindow}
        />
      )}
      {view === "lateness" && <LatenessView />}
      {view === "unexcused" && <UnexcusedView />}
      {view === "weekly" && <WeeklyView />}
      {view === "practices" && <EveryPracticeView />}
    </div>
  );
}

/** Minutes late, per dance, summed by month and by semester.
 *
 * Minutes are the only figure shown, on purpose: the question this screen
 * answers is "how many minutes late was this person", and anything else
 * crowds it. */
async function LatenessView() {
  const semesters = await getLatenessBySemester();

  if (semesters.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
        Nobody has been late to a practice yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Minutes late per person, broken out by dance and summed for each month
        and each semester. Late is anything past the threshold in Settings; an
        agreed late arrival never counts against anyone.
      </p>

      {semesters.map((semester) => (
        <section
          key={semester.key}
          className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
              {semester.label}
            </h2>
            <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
              {semester.total} min across the team
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-zinc-400">
                  <th className="px-4 py-2 font-medium">Person / dance</th>
                  {semester.months.map((month) => (
                    <th
                      key={month.key}
                      className="px-3 py-2 text-right font-medium"
                    >
                      {month.label}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right font-medium">Semester</th>
                </tr>
              </thead>
              <tbody>
                {semester.people.map((person) => (
                  <Fragment key={person.userId}>
                    <tr className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/60">
                      <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">
                        {person.name}
                      </td>
                      {semester.months.map((month) => (
                        <td
                          key={month.key}
                          className="px-3 py-2 text-right font-medium text-zinc-700 dark:text-zinc-200"
                        >
                          {minutesCell(person.byMonth.get(month.key))}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right font-semibold text-amber-700 dark:text-amber-400">
                        {person.total} min
                      </td>
                    </tr>

                    {person.dances.map((dance) => (
                      <tr
                        key={dance.danceId}
                        className="border-t border-zinc-100 dark:border-zinc-800/60"
                      >
                        <td className="py-1.5 pl-8 pr-4 text-zinc-600 dark:text-zinc-400">
                          {dance.danceName}
                        </td>
                        {semester.months.map((month) => (
                          <td
                            key={month.key}
                            className="px-3 py-1.5 text-right text-zinc-600 dark:text-zinc-400"
                          >
                            {minutesCell(dance.byMonth.get(month.key))}
                          </td>
                        ))}
                        <td className="px-4 py-1.5 text-right text-zinc-600 dark:text-zinc-400">
                          {dance.total} min
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function minutesCell(minutes: number | undefined) {
  if (!minutes) {
    return <span className="text-zinc-300 dark:text-zinc-700">—</span>;
  }
  return `${minutes} min`;
}

async function ByPersonView({
  threshold,
  windowSize,
}: {
  threshold: number;
  windowSize: number;
}) {
  const people = await getPersonRollups(threshold, windowSize);

  if (people.length === 0) {
    return <Empty message="No attendance has been marked yet." />;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Everyone on the roster, worst attendance first. Expand a row to see the
        breakdown per dance. Lateness is reported here but never counts toward
        a flag.
      </p>
      {people.map((person) => (
        <details
          key={person.userId}
          className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <summary className="grid cursor-pointer grid-cols-2 items-center gap-2 text-sm sm:grid-cols-6">
            <Link
              href={`/admin/roster/${person.userId}`}
              className="font-medium text-zinc-900 hover:underline dark:text-zinc-50"
            >
              {person.name}
            </Link>
            <span className="text-zinc-500">
              {person.totalPresent}/{person.totalPractices} attended
            </span>
            <span className="text-zinc-500">
              {person.totalExcused} excused
            </span>
            <span
              className={
                person.totalMinutesLate > 0
                  ? "font-medium text-amber-700 dark:text-amber-400"
                  : "text-zinc-500"
              }
            >
              {person.totalLate} late
              {person.totalMinutesLate > 0 && ` · ${person.totalMinutesLate} min`}
            </span>
            <span
              className={
                person.totalUnexcused > 0
                  ? "font-medium text-red-600 dark:text-red-400"
                  : "text-zinc-500"
              }
            >
              {person.totalUnexcused} unexcused
            </span>
            <span className="text-right font-medium text-zinc-700 dark:text-zinc-200">
              {person.attendanceRate}%
            </span>
          </summary>

          <table className="mt-3 w-full border-t border-zinc-100 pt-2 text-sm dark:border-zinc-800">
            <thead className="text-left text-xs uppercase text-zinc-400">
              <tr>
                <th className="py-1">Dance</th>
                <th className="py-1">Practices</th>
                <th className="py-1">Late</th>
                <th className="py-1">Missed (excused)</th>
                <th className="py-1">Missed (unexcused)</th>
              </tr>
            </thead>
            <tbody>
              {person.perDance.map((cell) => (
                <tr key={cell.danceId}>
                  <td className="py-1 text-zinc-800 dark:text-zinc-200">
                    {cell.danceName}
                    {cell.isFlagged && (
                      <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
                        Flagged
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-zinc-600 dark:text-zinc-400">
                    {cell.present}/{cell.practicesMarked}
                  </td>
                  <td className="py-1 text-zinc-600 dark:text-zinc-400">
                    {cell.late > 0 ? `${cell.late} · ${cell.minutesLate} min` : "—"}
                  </td>
                  <td className="py-1 text-zinc-600 dark:text-zinc-400">
                    {cell.excused}
                  </td>
                  <td
                    className={`py-1 ${
                      cell.unexcused > 0
                        ? "font-medium text-red-600 dark:text-red-400"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {cell.unexcused}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}

async function UnexcusedView() {
  const rows = await getUnexcusedAbsences();

  if (rows.length === 0) {
    return <Empty message="No unexcused absences. Everyone's been accounted for." />;
  }

  // Group by person so repeat offenders are obvious at a glance.
  const byPerson = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!byPerson.has(row.userId)) byPerson.set(row.userId, []);
    byPerson.get(row.userId)!.push(row);
  }
  const grouped = Array.from(byPerson.values()).sort(
    (a, b) => b.length - a.length,
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Only absences with no excused conflict logged — {rows.length} in total.
      </p>
      {grouped.map((personRows) => (
        <section
          key={personRows[0].userId}
          className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium text-zinc-900 dark:text-zinc-50">
              {personRows[0].name}
            </span>
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
              {personRows.length} unexcused
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {personRows.map((row) => (
              <li
                key={`${row.practiceId}-${row.userId}`}
                className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-1.5 text-sm dark:bg-zinc-800"
              >
                <span className="text-zinc-700 dark:text-zinc-300">
                  {row.danceName}
                </span>
                <span className="text-zinc-500">
                  {dateFormatter.format(row.startDateTime)}
                </span>
                <AttendanceBadge status="UNEXCUSED_ABSENT" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

async function WeeklyView() {
  const dances = await getWeeklyRollupByDance();

  if (dances.length === 0) {
    return <Empty message="No marked practices yet." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Week by week, for each dance: how much of the cast was missing and who.
      </p>
      {dances.map((dance) => (
        <section
          key={dance.danceId}
          className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 className="mb-3 font-medium text-zinc-900 dark:text-zinc-50">
            {dance.danceName}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-zinc-400">
                <tr>
                  <th className="py-1 pr-3">Week</th>
                  <th className="py-1 pr-3">Practices</th>
                  <th className="py-1 pr-3">Missing</th>
                  <th className="py-1">Who</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {dance.weeks.map((week) => (
                  <tr key={week.weekOf.toISOString()}>
                    <td className="py-2 pr-3 whitespace-nowrap text-zinc-700 dark:text-zinc-300">
                      {formatWeekLabel(week.weekOf)}
                    </td>
                    <td className="py-2 pr-3 text-zinc-500">
                      {week.practiceCount}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span
                        className={`font-medium ${
                          week.absentPercent >= 30
                            ? "text-red-600 dark:text-red-400"
                            : "text-zinc-700 dark:text-zinc-200"
                        }`}
                      >
                        {week.absentNames.length}/{week.castSize} (
                        {week.absentPercent}%)
                      </span>
                    </td>
                    <td className="py-2 text-zinc-600 dark:text-zinc-400">
                      {week.absentNames.length === 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          Full cast
                        </span>
                      ) : (
                        <span>
                          {week.absentNames.join(", ")}
                          {week.unexcusedNames.length > 0 && (
                            <span className="ml-1 text-xs text-red-600 dark:text-red-400">
                              ({week.unexcusedNames.length} unexcused)
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

async function EveryPracticeView() {
  const practices = await getPastPracticesWithAttendance();

  if (practices.length === 0) {
    return <Empty message="No practices have happened yet." />;
  }

  // "Not submitted" is the thing that needs chasing now — a practice can
  // have check-ins on it and still be waiting for a choreographer's sign-off.
  const unmarked = practices.filter((p) => p.submittedAt === null);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Every practice that has happened. Choreographers mark their own
        dances — this is so you can see where that hasn&rsquo;t happened yet,
        and step in if you need to.
      </p>

      {unmarked.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <h2 className="mb-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
            Not submitted yet ({unmarked.length})
          </h2>
          <ul className="flex flex-col gap-1">
            {unmarked.map((p) => (
              <li
                key={p.practiceId}
                className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-800 dark:text-amber-300"
              >
                <span className="font-medium">{p.danceName}</span>
                <span>{dateFormatter.format(p.startDateTime)}</span>
                <Link
                  href={`/attendance/${p.practiceId}`}
                  className="text-xs font-medium underline"
                >
                  Open →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-3">
        {practices.map((practice) => (
          <details
            key={practice.practiceId}
            className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {practice.danceName}
              </span>
              <span className="text-zinc-500">
                {dateFormatter.format(practice.startDateTime)}
              </span>
              {practice.isMarked ? (
                <span className="text-xs text-zinc-600 dark:text-zinc-300">
                  {practice.summary.presentCount}/{practice.summary.markedCount}{" "}
                  present · {practice.summary.absentPercent}% missing
                  {practice.summary.unexcusedCount > 0 && (
                    <span className="ml-1 font-medium text-red-600 dark:text-red-400">
                      ({practice.summary.unexcusedCount} unexcused)
                    </span>
                  )}
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                  Nobody checked in
                </span>
              )}
              {practice.summary.lateCount > 0 && (
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  {practice.summary.lateCount} late ·{" "}
                  {practice.summary.totalMinutesLate} min
                </span>
              )}
              <Link
                href={`/attendance/${practice.practiceId}`}
                className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
              >
                Open →
              </Link>
            </summary>
            <ul className="mt-3 flex flex-col gap-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              {practice.rows.map((row) => (
                <li
                  key={row.userId}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {row.name}
                  </span>
                  <AttendanceBadge status={row.status} minutesLate={row.minutesLate} />
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <p className="text-sm text-zinc-500 dark:text-zinc-400">{message}</p>
  );
}
