import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { googleCalendarAddUrl } from "@/lib/calendar-links";
import { getOpenCheckIns } from "@/lib/actions/attendance";
import { CheckInCard } from "@/components/check-in-card";
import { PushToggle } from "@/components/push-toggle";
import { startOfWeek, addDays, formatWeekLabel, toDateParam } from "@/lib/dates";
import { APP_TIME_ZONE } from "@/lib/timezone";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
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

  const greeting = `Hi ${firstName(user.name, user.email ?? "")}`;

  if (memberships.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {greeting}
        </h1>
        <p className="text-sm text-ink-soft">
          You&rsquo;re not in any dances yet. Once the AD adds you to one,
          it&rsquo;ll show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {greeting}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
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
          className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 text-sm transition-colors hover:bg-surface-2"
        >
          <span className="text-ink-soft">
            Add this week ({formatWeekLabel(weekStart)}) to your calendar
          </span>
          <span className="font-medium text-accent">
            Download →
          </span>
        </a>
      )}

      {memberships.map(({ dance, role }) => (
        <section
          key={dance.id}
          className="rounded-xl border border-line bg-surface p-4"
        >
          <div className="mb-3 flex items-center gap-2">
            <h2 className="font-medium text-ink">
              {dance.name}
            </h2>
            <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-ink-soft bg-surface-3">
              {role === "CHOREOGRAPHER" ? "Choreographer" : "Dancer"}
            </span>
          </div>

          {dance.practices.length === 0 ? (
            <p className="text-sm text-ink-soft">
              Nothing scheduled yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {dance.practices.map((practice) => (
                <li
                  key={practice.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-2 px-3 py-2 text-sm bg-surface/60"
                >
                  <span className="font-medium text-ink">
                    {dateFormatter.format(practice.startDateTime)}
                  </span>
                  <span className="text-xs text-ink-soft">
                    {practice.space?.name ?? "Space TBD"}
                  </span>
                  {practice.plannedArrivals[0] && (
                    <span className="rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                      you&rsquo;re due at{" "}
                      {timeFormatter.format(practice.plannedArrivals[0].arriveAt)}
                    </span>
                  )}
                  {practice.status === "PROPOSED" && (
                    <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
                      Not final yet
                    </span>
                  )}
                  {practice.status === "CONFIRMED" && (
                    <Link
                      href={`/attendance/${practice.id}`}
                      className="ml-auto text-xs font-medium text-accent underline-offset-2 hover:underline"
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
                      className="text-xs font-medium text-accent hover:underline"
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
