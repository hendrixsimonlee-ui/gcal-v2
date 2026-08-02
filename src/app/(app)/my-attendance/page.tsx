import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAttendanceSettings } from "@/lib/actions/attendance";
import { getPersonAttendance } from "@/lib/attendance-data";
import { AttendanceBadge } from "@/components/attendance-badge";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export default async function MyAttendancePage() {
  const session = await auth();
  const userId = session!.user.id;

  const [settings, me] = await Promise.all([
    getAttendanceSettings(),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { chronicAbsenceThreshold: true },
    }),
  ]);

  const groups = await getPersonAttendance(
    userId,
    me.chronicAbsenceThreshold ?? settings.chronicAbsenceThreshold,
    settings.chronicAbsenceWindow,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          My Attendance
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Your record for each dance you&rsquo;re in, based on what your
          choreographer marked after each practice.
        </p>
      </div>

      {groups.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          You&rsquo;re not in any dances yet.
        </p>
      )}

      {groups.map((group) => (
        <section
          key={group.danceId}
          className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium text-zinc-900 dark:text-zinc-50">
              {group.danceName}
            </h2>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500">
                {group.presentCount} present · {group.excusedAbsences} excused ·{" "}
                {group.unexcusedAbsences} unexcused
              </span>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                {group.attendanceRate}% attendance
              </span>
            </div>
          </div>

          {group.isFlagged && (
            <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
              Heads up: you&rsquo;ve missed {group.unexcusedAbsences} recent
              practices without an excused conflict. Your choreographer and the
              AD can see this.
            </p>
          )}

          {group.entries.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No practices have been marked yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {group.entries.map((entry) => (
                <li
                  key={entry.practiceId}
                  className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-1.5 text-sm dark:bg-zinc-800"
                >
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {dateFormatter.format(entry.startDateTime)}
                  </span>
                  <AttendanceBadge kind={entry.kind} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
