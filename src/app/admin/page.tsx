import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { startOfWeek, addDays, formatWeekLabel } from "@/lib/dates";

function firstName(name: string | null | undefined, email: string): string {
  if (!name) return email.split("@")[0];
  return name.split(" ")[0];
}

/** The AD's landing page: the week's work in the order it has to happen.
 * Review conflicts, sort the spaces, build the schedule, publish. Without
 * this the order lives only in somebody's head. */
export default async function AdminHomePage() {
  const session = await auth();
  const user = session!.user;

  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 7);

  const [
    unreviewed,
    danceCount,
    weekPractices,
    weeksOff,
    drafts,
    unsubmitted,
    rosterCount,
    spaceCount,
    settings,
  ] = await Promise.all([
      prisma.conflict.count({
        where: { weekOf: weekStart, status: "NOT_REVIEWED" },
      }),
      prisma.dance.count({ where: { archivedAt: null } }),
      prisma.practice.findMany({
        where: {
          dance: { archivedAt: null },
          startDateTime: { gte: weekStart, lt: weekEnd },
        },
        select: { danceId: true, status: true },
      }),
      prisma.danceWeekOff.count({ where: { weekOf: weekStart } }),
      prisma.practice.count({ where: { status: "PROPOSED" } }),
      prisma.practice.count({
        where: {
          status: "CONFIRMED",
          endDateTime: { lt: new Date() },
          attendanceSubmittedAt: null,
          dance: { archivedAt: null },
        },
      }),
      prisma.user.count(),
      prisma.space.count(),
      prisma.appSettings.findUnique({
        where: { id: "singleton" },
        select: { teamCalendarId: true },
      }),
    ]);

  // Four things have to exist before any of the weekly work means anything.
  // Until they do, the checklist below is describing work that can't be done
  // yet, so the setup steps take over the page and then disappear for good.
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

  const scheduledDances = new Set(weekPractices.map((p) => p.danceId)).size;
  const sorted = scheduledDances + weeksOff;

  const steps = [
    {
      href: "/admin/conflicts",
      label: "Review conflicts",
      detail:
        unreviewed === 0
          ? "Everything logged this week has an answer."
          : `${unreviewed} still marked "not reviewed".`,
      done: unreviewed === 0,
    },
    {
      href: "/admin/spaces",
      label: "Sort the spaces",
      detail: "Sync the room calendars and note anything different this week.",
      done: null,
    },
    {
      href: "/admin/schedule-builder",
      label: "Build the schedule",
      detail:
        danceCount === 0
          ? "No active dances yet."
          : sorted >= danceCount
            ? `All ${danceCount} dances sorted.`
            : `${sorted} of ${danceCount} dances sorted.`,
      done: danceCount > 0 && sorted >= danceCount,
    },
    {
      href: "/admin/schedule-builder",
      label: "Publish",
      detail:
        drafts === 0
          ? "Nothing waiting to be announced."
          : `${drafts} draft${drafts === 1 ? "" : "s"} nobody has been told about.`,
      done: drafts === 0,
    },
    {
      href: "/admin/attendance",
      label: "Check attendance",
      detail:
        unsubmitted === 0
          ? "Every finished practice has been signed off."
          : `${unsubmitted} finished practice${unsubmitted === 1 ? "" : "s"} not submitted yet.`,
      done: unsubmitted === 0,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Hi {firstName(user.name, user.email ?? "")}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {setupDone
            ? `Here's where you are for the week of ${formatWeekLabel(weekStart)}.`
            : "Let's get you set up — a few one-off things first."}
        </p>
      </div>

      {!setupDone && (
        <section className="rounded-xl border border-info/35 bg-info-soft p-4">
          <h2 className="text-sm font-semibold text-info">
            Setting up ({setupSteps.filter((s) => s.done).length} of{" "}
            {setupSteps.length} done)
          </h2>
          <p className="mb-3 text-xs text-info /80">
            Do these once, in this order, before the weekly work below will
            make sense. This box disappears when they&rsquo;re all done.
          </p>
          <ol className="flex flex-col gap-2">
            {setupSteps.map((step, i) => (
              <li key={step.href}>
                <Link
                  href={step.href}
                  className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2 transition-colors hover:bg-info-soft/60"
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${ step.done
                        ? "bg-good-soft text-good  "
                        : "bg-surface-3 text-ink-soft bg-surface-3 "
                    }`}
                  >
                    {step.done ? <CheckMark /> : i + 1}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-ink">
                      {step.label}
                    </span>
                    <span className="text-xs text-ink-soft">
                      {step.detail}
                    </span>
                  </span>
                  <span className="ml-auto text-ink-soft">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li key={`${step.href}-${i}`}>
            <Link
              href={step.href}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${ step.done
                    ? "bg-good-soft text-good  "
                    : "bg-surface-3 text-ink-soft bg-surface-3 "
                }`}
              >
                {step.done ? <CheckMark /> : i + 1}
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-medium text-ink">
                  {step.label}
                </span>
                <span className="text-xs text-ink-soft">
                  {step.detail}
                </span>
              </span>
              <span className="ml-auto text-ink-soft">→</span>
            </Link>
          </li>
        ))}
      </ol>
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
