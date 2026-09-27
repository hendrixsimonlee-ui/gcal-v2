import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { startOfWeek, addDays, formatWeekLabel } from "@/lib/dates";
import { APP_TIME_ZONE } from "@/lib/timezone";
import { WeekAtAGlance } from "@/components/week-at-a-glance";

function firstName(name: string | null | undefined, email: string): string {
  if (!name) return email.split("@")[0];
  return name.split(" ")[0];
}

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  month: "numeric",
  day: "numeric",
});

/** The AD's landing page: this week, and what still needs signing off.
 *
 * Two things, because two is what gets read. This has been a numbered
 * checklist of five jobs with ticks beside them, and then a list of every
 * outstanding item written out in sentences — both of which turned a glance
 * into a paragraph. The schedule is the thing worth seeing, and attendance is
 * the only job that queues up rather than being done in one sitting.
 *
 * Everything else the AD needs has a screen of its own and a place in the
 * nav; repeating it here was this page inventing work for itself. */
export default async function AdminHomePage() {
  const session = await auth();
  const user = session!.user;

  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 7);

  // This week and the three ahead. Far enough to see whether next week is in
  // hand without turning the strip into a term planner.
  const WEEKS_AHEAD = 4;
  const horizon = addDays(weekStart, WEEKS_AHEAD * 7);

  const [
    weekPractices,
    toReview,
    horizonPractices,
    weeksOff,
    rosterCount,
    spaceCount,
    danceCount,
    settings,
  ] = await Promise.all([
      prisma.practice.findMany({
        where: {
          dance: { archivedAt: null },
          startDateTime: { gte: weekStart, lt: weekEnd },
        },
        select: {
          id: true,
          danceId: true,
          status: true,
          startDateTime: true,
          endDateTime: true,
          dance: { select: { name: true } },
          space: { select: { name: true } },
        },
        orderBy: { startDateTime: "asc" },
      }),
      // Finished, nobody has signed it off. Oldest first: the one that has
      // been waiting longest is the one most likely to have been forgotten.
      prisma.practice.findMany({
        where: {
          status: "CONFIRMED",
          endDateTime: { lt: new Date() },
          attendanceSubmittedAt: null,
          dance: { archivedAt: null },
        },
        select: {
          id: true,
          startDateTime: true,
          dance: { select: { name: true } },
        },
        orderBy: { startDateTime: "asc" },
      }),
      // Which dances have a time in each of the coming weeks, for the strip.
      prisma.practice.findMany({
        where: {
          dance: { archivedAt: null },
          startDateTime: { gte: weekStart, lt: horizon },
        },
        select: { danceId: true, status: true, startDateTime: true },
      }),
      // A dance the AD deliberately gave a week off is sorted, not missing.
      prisma.danceWeekOff.findMany({
        where: { weekOf: { gte: weekStart, lt: horizon } },
        select: { danceId: true, weekOf: true },
      }),
      prisma.user.count(),
      prisma.space.count(),
      prisma.dance.count({ where: { archivedAt: null } }),
      prisma.appSettings.findUnique({
        where: { id: "singleton" },
        select: { teamCalendarId: true },
      }),
    ]);

  // The one-off things that have to exist before any of this means anything.
  // It takes over the page until they're done, then never appears again.
  const setupSteps = [
    {
      href: "/admin/roster",
      label: "Add the roster",
      detail:
        rosterCount > 1
          ? `${rosterCount} people added.`
          : "Everyone's name and the email they'll sign in to Google with.",
      done: rosterCount > 1,
    },
    {
      href: "/admin/spaces",
      label: "Add your spaces",
      detail:
        spaceCount > 0
          ? `${spaceCount} space${spaceCount === 1 ? "" : "s"} set up.`
          : "Each room and the hours it's usually yours.",
      done: spaceCount > 0,
    },
    {
      href: "/admin/dances",
      label: "Add the dances",
      detail:
        danceCount > 0
          ? `${danceCount} dance${danceCount === 1 ? "" : "s"} set up.`
          : "Each piece, its choreographers and cast, and how long it usually runs.",
      done: danceCount > 0,
    },
    {
      href: "/admin/settings",
      label: "Link the team calendar",
      detail: settings?.teamCalendarId
        ? "Published practices write themselves onto it."
        : "The shared PADT calendar, so published practices appear on it.",
      done: Boolean(settings?.teamCalendarId),
    },
  ];
  const setupDone = setupSteps.every((s) => s.done);

  // One entry per week: how many dances have a time, and whether anything in
  // it is still a draft. "Scheduled" means every dance is either placed or
  // deliberately off — a week with four of five placed is not done.
  const weekStatuses = Array.from({ length: WEEKS_AHEAD }, (_, i) => {
    const start = addDays(weekStart, i * 7);
    const end = addDays(start, 7);
    const inWeek = horizonPractices.filter(
      (p) => p.startDateTime >= start && p.startDateTime < end,
    );
    const placed = new Set(inWeek.map((p) => p.danceId));
    const off = new Set(
      weeksOff
        .filter((w) => w.weekOf >= start && w.weekOf < end)
        .map((w) => w.danceId),
    );
    const sorted = new Set([...placed, ...off]).size;
    return {
      start,
      label: formatWeekLabel(start),
      sorted,
      total: danceCount,
      hasDrafts: inWeek.some((p) => p.status === "PROPOSED"),
      isThisWeek: i === 0,
    };
  });

  // Attendance grouped by the week the practice happened in. A flat list of
  // fifteen practices spanning a month reads as a backlog with no shape; by
  // week it reads as "last week is done, the week before isn't".
  const reviewWeeks = new Map<
    string,
    { start: Date; label: string; practices: typeof toReview }
  >();
  for (const practice of toReview) {
    const start = startOfWeek(practice.startDateTime);
    const key = start.toISOString();
    const entry = reviewWeeks.get(key) ?? {
      start,
      label: formatWeekLabel(start),
      practices: [],
    };
    entry.practices.push(practice);
    reviewWeeks.set(key, entry);
  }
  // Oldest week first: the one that has been waiting longest is the one most
  // likely to have been forgotten.
  const groupedReview = [...reviewWeeks.values()].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );

  if (!setupDone) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Hi {firstName(user.name, user.email ?? "")}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Let&rsquo;s get you set up — a few one-off things first.
          </p>
        </div>

        <section className="rounded-xl border border-info/35 bg-info-soft p-4">
          <h2 className="text-sm font-semibold text-info">
            Setting up ({setupSteps.filter((s) => s.done).length} of{" "}
            {setupSteps.length} done)
          </h2>
          <ol className="mt-3 flex flex-col gap-2">
            {setupSteps.map((step, i) => (
              <li key={step.href}>
                <Link
                  href={step.href}
                  className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2 transition-colors hover:bg-info-soft/60"
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${ step.done
                        ? "bg-good-soft text-good"
                        : "bg-surface-3 text-ink-soft"
                    }`}
                  >
                    {step.done ? <CheckMark /> : i + 1}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-ink">
                      {step.label}
                    </span>
                    <span className="text-xs text-ink-soft">{step.detail}</span>
                  </span>
                  <span className="ml-auto text-ink-soft">→</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* No week label here: the calendar's own toolbar says which week is
          showing, and it stays right when you page back and forth. */}
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Hi {firstName(user.name, user.email ?? "")}
      </h1>

      {/* Which weeks are sorted and which aren't, at a glance. Four weeks out
          is far enough to catch next week being empty while there is still
          time to do something about it. */}
      <ul className="flex flex-wrap gap-2">
        {weekStatuses.map((week) => {
          const done = week.total > 0 && week.sorted >= week.total;
          return (
            <li key={week.start.toISOString()} className="flex-1 min-w-40">
              <Link
                // Plainly to the builder: it owns which week it shows, via
                // its own Jump to control, and inventing a query parameter it
                // doesn't read would be a link that quietly does nothing.
                href="/admin/schedule-builder"
                className={`flex flex-col gap-0.5 rounded-xl border px-3 py-2 transition-colors ${ done
                    ? "border-good/35 bg-good-soft hover:bg-good-soft/70"
                    : "border-warn/35 bg-warn-soft hover:bg-warn-soft/70"
                }`}
              >
                <span
                  className={`text-xs font-medium ${ done ? "text-good" : "text-warn"
                  }`}
                >
                  {week.isThisWeek ? "This week" : week.label}
                </span>
                <span
                  className={`text-sm font-semibold ${ done ? "text-good" : "text-warn"
                  }`}
                >
                  {week.total === 0
                    ? "No dances"
                    : done
                      ? week.hasDrafts
                        ? "Scheduled, not published"
                        : "Scheduled"
                      : `${week.sorted} of ${week.total} scheduled`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <WeekAtAGlance
        practices={weekPractices.map((p) => ({
          id: p.id,
          danceId: p.danceId,
          danceName: p.dance.name,
          spaceName: p.space?.name ?? null,
          startDateTime: p.startDateTime.toISOString(),
          endDateTime: p.endDateTime.toISOString(),
          status: p.status as "PROPOSED" | "CONFIRMED",
        }))}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">Attendance to review</h2>
        {groupedReview.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
            Every finished practice is signed off.
          </p>
        ) : (
          groupedReview.map((week) => (
            <div key={week.start.toISOString()} className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                  {week.label}
                </h3>
                <span className="text-xs text-ink-faint">
                  {week.practices.length}
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {week.practices.map((practice) => (
                  <li key={practice.id}>
                    <Link
                      href={`/attendance/${practice.id}`}
                      className="flex flex-wrap items-baseline gap-x-3 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm transition-colors hover:bg-surface-2"
                    >
                      <span className="font-medium text-ink">
                        {practice.dance.name}
                      </span>
                      <span className="text-ink-soft">
                        {dayFormatter.format(practice.startDateTime)}
                      </span>
                      <span className="ml-auto text-ink-soft">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

/** A drawn tick rather than a text character, so it renders identically
 * everywhere and reads as an icon rather than as content. */
function CheckMark() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
