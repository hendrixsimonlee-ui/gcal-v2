import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  getPastPracticesWithAttendance,
  getUpcomingPracticesForDances,
} from "@/lib/attendance-data";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function AttendanceCheckOffPage() {
  const session = await auth();
  const userId = session!.user.id;

  const choreographedDances = await prisma.danceMembership.findMany({
    where: { userId, role: "CHOREOGRAPHER", dance: { archivedAt: null } },
    select: { danceId: true },
  });
  const danceIds = choreographedDances.map((m) => m.danceId);

  if (danceIds.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Attendance
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          You don&rsquo;t choreograph any dances, so there&rsquo;s nothing to
          sign off here.
        </p>
      </div>
    );
  }

  const [practices, upcoming] = await Promise.all([
    getPastPracticesWithAttendance(danceIds),
    getUpcomingPracticesForDances(danceIds),
  ]);
  // What needs a choreographer now is submitting, not ticking boxes — the
  // check-ins arrive on their own.
  const unmarked = practices.filter((p) => p.submittedAt === null);
  const marked = practices.filter((p) => p.submittedAt !== null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Attendance
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Practices for the dances you choreograph. Everyone checks themselves
          in — you look over the recap and submit it.
        </p>
      </div>

      {upcoming.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Coming up
          </h2>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            Open one to see who&rsquo;s expected, who&rsquo;s excused, and
            who&rsquo;s arriving late.
          </p>
          <ul className="flex flex-col gap-2">
            {upcoming.map((p) => (
              <li key={p.practiceId}>
                <Link
                  href={`/attendance/${p.practiceId}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                >
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {p.danceName}
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {dateFormatter.format(p.startDateTime)}
                  </span>
                  {p.spaceName && (
                    <span className="text-xs text-zinc-500">{p.spaceName}</span>
                  )}
                  <span className="ml-auto text-xs text-zinc-500">
                    {p.expectedCount} expected
                    {p.excusedCount > 0 && ` · ${p.excusedCount} excused`}
                    {p.lateCount > 0 && ` · ${p.lateCount} arriving late`}
                  </span>
                  <span className="text-zinc-300 dark:text-zinc-600">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Needs your sign-off ({unmarked.length})
        </h2>
        {unmarked.length === 0 ? (
          <p className="text-sm text-zinc-500">All caught up.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {unmarked.map((p) => (
              <li key={p.practiceId}>
                <Link
                  href={`/attendance/${p.practiceId}`}
                  className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:hover:bg-amber-900"
                >
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {p.danceName}
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {dateFormatter.format(p.startDateTime)}
                  </span>
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    Review &amp; submit →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Signed off
        </h2>
        {marked.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing signed off yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {marked.map((p) => (
              <li key={p.practiceId}>
                <Link
                  href={`/attendance/${p.practiceId}`}
                  className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-sm hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                >
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {p.danceName}
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {dateFormatter.format(p.startDateTime)}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {p.summary.presentCount}/{p.summary.markedCount} there
                    {p.summary.lateCount > 0 && ` · ${p.summary.lateCount} late`}
                    {p.summary.unexcusedCount > 0 &&
                      ` · ${p.summary.unexcusedCount} unexcused`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
