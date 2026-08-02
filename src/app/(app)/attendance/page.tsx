import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPastPracticesWithAttendance } from "@/lib/attendance-data";

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
    where: { userId, role: "CHOREOGRAPHER" },
    select: { danceId: true },
  });
  const danceIds = choreographedDances.map((m) => m.danceId);

  if (danceIds.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Attendance Check-off
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          You don&rsquo;t choreograph any dances, so there&rsquo;s nothing to
          check off here.
        </p>
      </div>
    );
  }

  const practices = await getPastPracticesWithAttendance(danceIds);
  const unmarked = practices.filter((p) => !p.isMarked);
  const marked = practices.filter((p) => p.isMarked);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Attendance Check-off
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Practices for the dances you choreograph. Tick off who showed up.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Needs check-off ({unmarked.length})
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
                    Mark attendance →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Already marked
        </h2>
        {marked.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing marked yet.</p>
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
                    {p.summary.presentCount}/{p.summary.markedCount} present (
                    {p.summary.absentPercent}% missing)
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
