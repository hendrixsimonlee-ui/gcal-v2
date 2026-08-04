import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  getPastPracticesWithAttendance,
  getUpcomingPracticesForDances,
} from "@/lib/attendance-data";
import { APP_TIME_ZONE } from "@/lib/timezone";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const clockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
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
        <h1 className="text-xl font-semibold text-ink">
          Attendance
        </h1>
        <p className="text-sm text-ink-soft">
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
        <h1 className="text-xl font-semibold text-ink">
          Attendance
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Practices for the dances you choreograph. Everyone checks themselves
          in — you look over the recap and submit it.
        </p>
      </div>

      {upcoming.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">
            Coming up
          </h2>
          <p className="mb-2 text-xs text-ink-soft">
            Open one to see who&rsquo;s expected, who&rsquo;s excused, and
            who&rsquo;s arriving late.
          </p>
          <ul className="flex flex-col gap-2">
            {upcoming.map((p) => (
              <li key={p.practiceId}>
                <Link
                  href={`/attendance/${p.practiceId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm transition-colors hover:bg-surface-2"
                >
                  <span className="font-medium text-ink">
                    {p.danceName}
                  </span>
                  <span className="text-ink-soft">
                    {dateFormatter.format(p.startDateTime)} –{" "}
                    {clockFormatter.format(p.endDateTime)}
                  </span>
                  {p.spaceName && (
                    <span className="text-xs text-ink-soft">{p.spaceName}</span>
                  )}
                  <span className="ml-auto text-xs text-ink-soft">
                    {p.expectedCount} expected
                    {p.excusedCount > 0 && ` · ${p.excusedCount} excused`} {p.lateCount > 0 && ` · ${p.lateCount} arriving late`}
                  </span>
                  <span className="text-ink-soft">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">
          Needs your sign-off ({unmarked.length})
        </h2>
        {unmarked.length === 0 ? (
          <p className="text-sm text-ink-soft">All caught up.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {unmarked.map((p) => (
              <li key={p.practiceId}>
                <Link
                  href={`/attendance/${p.practiceId}`}
                  className="flex items-center justify-between rounded-lg border border-warn/35 bg-warn-soft px-3 py-2 text-sm hover:bg-warn-soft"
                >
                  <span className="font-medium text-ink">
                    {p.danceName}
                  </span>
                  <span className="text-ink-soft">
                    {dateFormatter.format(p.startDateTime)} –{" "}
                    {clockFormatter.format(p.endDateTime)}
                  </span>
                  <span className="text-xs font-medium text-warn">
                    Review &amp; submit →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">
          Signed off
        </h2>
        {marked.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing signed off yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {marked.map((p) => (
              <li key={p.practiceId}>
                <Link
                  href={`/attendance/${p.practiceId}`} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm hover:bg-surface-3"
                >
                  <span className="font-medium text-ink">
                    {p.danceName}
                  </span>
                  <span className="text-ink-soft">
                    {dateFormatter.format(p.startDateTime)} –{" "}
                    {clockFormatter.format(p.endDateTime)}
                  </span>
                  <span className="text-xs text-ink-soft">
                    {p.summary.presentCount}/{p.summary.markedCount} there
                    {p.summary.lateCount > 0 && ` · ${p.summary.lateCount} late`} {p.summary.unexcusedCount > 0 &&
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
