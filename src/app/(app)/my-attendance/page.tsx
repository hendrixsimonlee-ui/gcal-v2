import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAttendanceSettings } from "@/lib/actions/attendance";
import { getPersonAttendance } from "@/lib/attendance-data";
import { AttendanceBadge } from "@/components/status-badges";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

/** Everyone's own record, kept as long as the app has it.
 *
 * Every practice is a link through to that practice's full record, so if
 * there's ever a question about who was there, both sides can open the same
 * page and look at the same thing. */
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

  // Archived pieces included: they're gone from scheduling, but their record
  // is exactly what someone needs when they're checking back on last season.
  const groups = await getPersonAttendance(
    userId,
    me.chronicAbsenceThreshold ?? settings.chronicAbsenceThreshold,
    settings.chronicAbsenceWindow,
    true,
  );

  const current = groups.filter((g) => !g.isArchived);
  const past = groups.filter((g) => g.isArchived);
  const totalMinutesLate = groups.reduce((sum, g) => sum + g.totalMinutesLate, 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          My Attendance
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every practice you&rsquo;ve had, and what was recorded. Tap any one
          to see the full record for that practice.
          {totalMinutesLate > 0 &&
            ` You're ${totalMinutesLate} minutes late in total so far.`}
        </p>
      </div>

      {groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          You&rsquo;re not in any dances yet.
        </p>
      )}

      {current.map((group) => (
        <DanceHistory key={group.danceId} group={group} />
      ))}

      {past.length > 0 && (
        <details className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Past seasons ({past.length})
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {past.map((group) => (
              <DanceHistory key={group.danceId} group={group} bare />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

type Group = Awaited<ReturnType<typeof getPersonAttendance>>[number];

function DanceHistory({ group, bare }: { group: Group; bare?: boolean }) {
  const body = (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-zinc-900 dark:text-zinc-50">
          {group.danceName}
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-zinc-500">
            {group.presentCount} there · {group.excusedAbsences} excused ·{" "}
            {group.unexcusedAbsences} unexcused
            {group.totalMinutesLate > 0 &&
              ` · ${group.totalMinutesLate} min late`}
          </span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
            {group.attendanceRate}%
          </span>
        </div>
      </div>

      {group.isFlagged && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
          Heads up: you&rsquo;ve missed {group.unexcusedAbsences} recent
          practices without an excused conflict. Your choreographer and the AD
          can see this.
        </p>
      )}

      {group.entries.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {group.entries.map((entry) => (
            <li key={entry.practiceId}>
              <Link
                href={`/attendance/${entry.practiceId}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-zinc-50 px-3 py-2 text-sm transition-colors hover:bg-zinc-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800"
              >
                <span className="text-zinc-800 dark:text-zinc-200">
                  {dateFormatter.format(entry.startDateTime)}
                </span>
                {entry.spaceName && (
                  <span className="text-xs text-zinc-500">
                    {entry.spaceName}
                  </span>
                )}
                {entry.checkedInAt && (
                  <span className="text-xs text-zinc-500">
                    checked in {timeFormatter.format(entry.checkedInAt)}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-2">
                  <AttendanceBadge
                    status={entry.status}
                    minutesLate={entry.minutesLate}
                  />
                  <span className="text-zinc-300 dark:text-zinc-600">→</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  if (bare) return <div>{body}</div>;
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {body}
    </section>
  );
}
