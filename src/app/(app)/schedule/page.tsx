import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { googleCalendarAddUrl } from "@/lib/calendar-links";
import { getOpenCheckIns } from "@/lib/actions/attendance";
import { CheckInCard } from "@/components/check-in-card";
import { PushToggle } from "@/components/push-toggle";
import { startOfWeek, addDays, formatWeekLabel, toDateParam } from "@/lib/dates";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

function firstName(name: string | null | undefined, email: string): string {
  if (!name) return email.split("@")[0];
  return name.split(" ")[0];
}

export default async function MySchedulePage() {
  const session = await auth();
  const user = session!.user;
  const userId = user.id;

  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 7);

  const [memberships, openCheckIns, thisWeekCount] = await Promise.all([
    prisma.danceMembership.findMany({
      where: { userId, dance: { archivedAt: null } },
      include: {
        dance: {
          include: {
            practices: {
              where: { endDateTime: { gte: new Date() } },
              orderBy: { startDateTime: "asc" },
              include: {
                space: true,
                plannedArrivals: { where: { userId } },
              },
            },
          },
        },
      },
      orderBy: { dance: { name: "asc" } },
    }),
    getOpenCheckIns(),
    prisma.practice.count({
      where: {
        status: "CONFIRMED",
        startDateTime: { gte: weekStart, lt: weekEnd },
        dance: { archivedAt: null, memberships: { some: { userId } } },
      },
    }),
  ]);

  const greeting = `Hi ${firstName(user.name, user.email ?? "")} 👋`;

  if (memberships.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {greeting}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          You&rsquo;re not in any dances yet. Once the AD adds you to one,
          it&rsquo;ll show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {greeting}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {thisWeekCount === 0
            ? "Nothing on your schedule this week."
            : `You have ${thisWeekCount} practice${thisWeekCount === 1 ? "" : "s"} this week.`}
        </p>
      </div>

      <CheckInCard initial={openCheckIns} />

      <PushToggle />

      {thisWeekCount > 0 && (
        <a
          href={`/api/my-week.ics?week=${toDateParam(weekStart)}`}
          className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          <span className="text-zinc-700 dark:text-zinc-300">
            Add this week ({formatWeekLabel(weekStart)}) to your calendar
          </span>
          <span className="font-medium text-sky-600 dark:text-sky-400">
            Download →
          </span>
        </a>
      )}

      {memberships.map(({ dance, role }) => (
        <section
          key={dance.id}
          className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="mb-3 flex items-center gap-2">
            <h2 className="font-medium text-zinc-900 dark:text-zinc-50">
              {dance.name}
            </h2>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {role === "CHOREOGRAPHER" ? "Choreographer" : "Dancer"}
            </span>
          </div>

          {dance.practices.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Nothing scheduled yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {dance.practices.map((practice) => (
                <li
                  key={practice.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60"
                >
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">
                    {dateFormatter.format(practice.startDateTime)}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {practice.space?.name ?? "Space TBD"}
                  </span>
                  {practice.plannedArrivals[0] && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                      you&rsquo;re due at{" "}
                      {timeFormatter.format(practice.plannedArrivals[0].arriveAt)}
                    </span>
                  )}
                  {practice.status === "PROPOSED" && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      Not final yet
                    </span>
                  )}
                  {practice.status === "CONFIRMED" && (
                    <Link
                      href={`/attendance/${practice.id}`}
                      className="ml-auto text-xs font-medium text-zinc-500 hover:underline"
                    >
                      Who&rsquo;s coming
                    </Link>
                  )}
                  {practice.status === "CONFIRMED" && (
                    <a
                      href={googleCalendarAddUrl({
                        title: `${dance.name} practice`,
                        start: practice.startDateTime,
                        end: practice.endDateTime,
                        location:
                          practice.space?.location ?? practice.space?.name ?? undefined,
                        details: `${dance.name} rehearsal.`,
                      })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
                    >
                      Add to calendar
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
