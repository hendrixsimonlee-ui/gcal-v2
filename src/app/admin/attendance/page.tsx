import Link from "next/link";
import { getAttendanceSettings } from "@/lib/actions/attendance";
import {
  getChronicAbsenceFlags,
  getPersonRollups,
  getUnexcusedAbsences,
  getWeeklyRollupByDance,
} from "@/lib/attendance-data";
import { AttendanceBadge } from "@/components/attendance-badge";
import { formatWeekLabel } from "@/lib/dates";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

type View = "person" | "unexcused" | "weekly";

const VIEWS: { key: View; label: string }[] = [
  { key: "person", label: "By person" },
  { key: "unexcused", label: "Unexcused only" },
  { key: "weekly", label: "By dance, week by week" },
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
  const flags = await getChronicAbsenceFlags(
    settings.chronicAbsenceThreshold,
    settings.chronicAbsenceWindow,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Attendance Review
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Flags trip at {settings.chronicAbsenceThreshold}{" "}
          unexcused absences out of a dancer&rsquo;s last{" "}
          {settings.chronicAbsenceWindow} practices for a dance —{" "}
          <Link href="/admin/settings" className="underline">
            change that in Settings
          </Link>
          .
        </p>
      </div>

      {flags.length > 0 && (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <h2 className="mb-2 text-sm font-semibold text-red-900 dark:text-red-200">
            Over the threshold ({flags.length})
          </h2>
          <ul className="flex flex-col gap-1">
            {flags.map((flag) => (
              <li
                key={`${flag.userId}-${flag.danceId}`}
                className="flex flex-wrap items-center justify-between gap-2 text-sm text-red-800 dark:text-red-300"
              >
                <span className="font-medium">{flag.name}</span>
                <span>{flag.danceName}</span>
                <span className="text-xs">
                  {flag.unexcusedInWindow} unexcused in last {flag.windowSize}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
      {view === "unexcused" && <UnexcusedView />}
      {view === "weekly" && <WeeklyView />}
    </div>
  );
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
        breakdown per dance.
      </p>
      {people.map((person) => (
        <details
          key={person.userId}
          className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <summary className="grid cursor-pointer grid-cols-2 items-center gap-2 text-sm sm:grid-cols-5">
            <span className="font-medium text-zinc-900 dark:text-zinc-50">
              {person.name}
            </span>
            <span className="text-zinc-500">
              {person.totalPresent}/{person.totalPractices} attended
            </span>
            <span className="text-zinc-500">
              {person.totalExcused} excused
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
                <AttendanceBadge kind={row.kind} />
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

function Empty({ message }: { message: string }) {
  return (
    <p className="text-sm text-zinc-500 dark:text-zinc-400">{message}</p>
  );
}
