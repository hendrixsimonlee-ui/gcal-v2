import Link from "next/link";
import { getAttendanceSettings } from "@/lib/actions/attendance";
import {
  getChronicAbsenceFlags,
  getPastPracticesWithAttendance,
} from "@/lib/attendance-data";
import { summarizePerson } from "@/lib/attendance";
import { AttendanceBadge } from "@/components/attendance-badge";
import type { AbsenceKind } from "@/lib/attendance";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function AdminAttendancePage() {
  const settings = await getAttendanceSettings();
  const [practices, flags] = await Promise.all([
    getPastPracticesWithAttendance(),
    getChronicAbsenceFlags(
      settings.chronicAbsenceThreshold,
      settings.chronicAbsenceWindow,
    ),
  ]);

  // Roll every marked practice up per person for the "who's missing overall"
  // leaderboard.
  const kindsByPerson = new Map<string, { name: string; kinds: AbsenceKind[] }>();
  for (const practice of practices) {
    for (const row of practice.rows) {
      if (row.kind === null) continue;
      if (!kindsByPerson.has(row.userId)) {
        kindsByPerson.set(row.userId, { name: row.name, kinds: [] });
      }
      kindsByPerson.get(row.userId)!.kinds.push(row.kind);
    }
  }

  const people = Array.from(kindsByPerson.entries())
    .map(([userId, { name, kinds }]) => ({
      name,
      ...summarizePerson(userId, kinds),
    }))
    .sort(
      (a, b) =>
        b.unexcusedAbsences - a.unexcusedAbsences ||
        a.attendanceRate - b.attendanceRate,
    );

  const markedPractices = practices.filter((p) => p.isMarked);
  const overallAbsentPercent =
    markedPractices.length === 0
      ? 0
      : Math.round(
          markedPractices.reduce((sum, p) => sum + p.summary.absentPercent, 0) /
            markedPractices.length,
        );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Attendance Review
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Across {markedPractices.length} marked practice
          {markedPractices.length === 1 ? "" : "s"}, an average of{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-200">
            {overallAbsentPercent}%
          </span>{" "}
          of the cast is missing. Flags below use the threshold set in{" "}
          <Link href="/admin/settings" className="underline">
            Settings
          </Link>
          .
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Chronic absence flags ({flags.length})
        </h2>
        {flags.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Nobody is over the threshold right now.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {flags.map((flag) => (
              <li
                key={`${flag.userId}-${flag.danceId}`}
                className="flex items-center justify-between rounded-md bg-red-50 px-3 py-2 text-sm dark:bg-red-950"
              >
                <span className="font-medium text-red-900 dark:text-red-200">
                  {flag.name}
                </span>
                <span className="text-red-700 dark:text-red-300">
                  {flag.danceName}
                </span>
                <span className="text-xs text-red-700 dark:text-red-300">
                  {flag.unexcusedInWindow} unexcused in last {flag.windowSize}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Who&rsquo;s missing overall
        </h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2">Person</th>
                <th className="px-4 py-2">Present</th>
                <th className="px-4 py-2">Excused</th>
                <th className="px-4 py-2">Unexcused</th>
                <th className="px-4 py-2">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {people.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                    No attendance has been marked yet.
                  </td>
                </tr>
              )}
              {people.map((person) => (
                <tr key={person.userId}>
                  <td className="px-4 py-2 text-zinc-900 dark:text-zinc-50">
                    {person.name}
                  </td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                    {person.presentCount}
                  </td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                    {person.excusedAbsences}
                  </td>
                  <td
                    className={`px-4 py-2 font-medium ${
                      person.unexcusedAbsences > 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {person.unexcusedAbsences}
                  </td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                    {person.attendanceRate}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Practice by practice
        </h2>
        {practices.length === 0 ? (
          <p className="text-sm text-zinc-500">No past practices yet.</p>
        ) : (
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
                      {practice.summary.presentCount}/
                      {practice.summary.markedCount} present ·{" "}
                      {practice.summary.absentPercent}% missing
                      {practice.summary.unexcusedCount > 0 && (
                        <span className="ml-1 font-medium text-red-600 dark:text-red-400">
                          ({practice.summary.unexcusedCount} unexcused)
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                      Not marked yet
                    </span>
                  )}
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
                      <AttendanceBadge kind={row.kind} />
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
