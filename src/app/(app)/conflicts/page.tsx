import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { WeekNav } from "@/components/week-nav";
import { ConflictsCalendar } from "@/components/conflicts-calendar";
import { addDays, formatWeekLabel, parseWeekParam, toDateParam } from "@/lib/dates";
import {
  deleteConflict,
} from "@/lib/actions/conflicts";
import { ConflictCalendarSync } from "@/components/conflict-calendar-sync";
import { ConflictStatusBadge } from "@/components/status-badges";
import { SubmitWeekButton } from "@/components/submit-week-button";
import { APP_TIME_ZONE } from "@/lib/timezone";

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});
// Out-of-town windows are `@db.Date` columns — a bare calendar day, handed
// back at UTC midnight. Reading them in Eastern showed the day before.
export default async function MyConflictsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const session = await auth();
  const userId = session!.user.id;

  const weekStart = parseWeekParam(week);

  const [me, weekConflicts, calendarConflicts, submission] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { conflictCalendarName: true },
      }),
      prisma.conflict.findMany({
        where: { userId, weekOf: weekStart },
        orderBy: { startDateTime: "asc" },
      }),
      // The calendar navigates independently of the week selector below, so
      // give it a wide window rather than just the selected week.
      prisma.conflict.findMany({
        where: {
          userId,
          startDateTime: { gte: addDays(new Date(), -60) },
          endDateTime: { lte: addDays(new Date(), 120) },
        },
        orderBy: { startDateTime: "asc" },
      }),
      prisma.conflictSubmission.findUnique({
        where: { userId_weekOf: { userId, weekOf: weekStart } },
        select: { submittedAt: true },
      }),
    ]);

  return (
    <div className="flex flex-col gap-8">
      <WeekNav
        basePath="/conflicts"
        weekStartKey={toDateParam(weekStart)}
        weekLabel={formatWeekLabel(weekStart)}
        todayKey={toDateParam(new Date())}
      />

      <div>
        <h1 className="text-xl font-semibold text-ink">
          My Conflicts
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Log every time you&rsquo;re busy so the AD can schedule around
          it.
        </p>
      </div>

      <ConflictCalendarSync
        linkedCalendarName={me.conflictCalendarName}
        weekStartIso={weekStart.toISOString()}
      />

      <section className="rounded-lg border border-line bg-surface p-4">
        <ConflictsCalendar
          conflicts={calendarConflicts.map((c) => ({
            id: c.id,
            startDateTime: c.startDateTime.toISOString(),
            endDateTime: c.endDateTime.toISOString(),
            title: c.title,
            status: c.status,
            isRecurring: c.isRecurring,
            fromGoogle: !!c.sourceGoogleEventId,
          }))}
        />
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        {/* The calendar above has its own week controls. Naming this list
            makes it obvious which week the buttons here are moving, instead
            of leaving two unlabelled week navigations on one screen. */}
        <h2 className="mb-2 text-sm font-semibold tracking-[-0.01em] text-ink">
          Conflicts you have logged
        </h2>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink">
            Week of {formatWeekLabel(weekStart)}
          </span>
        </div>

        <div className="mb-4">
          <SubmitWeekButton
            weekOfIso={weekStart.toISOString()}
            weekLabel={formatWeekLabel(weekStart)}
            submittedAtIso={submission?.submittedAt?.toISOString() ?? null}
            conflictCount={weekConflicts.length}
          />
        </div>

        <ul className="flex flex-col gap-1">
          {weekConflicts.length === 0 && (
            <li className="text-sm text-ink-soft">
              Nothing logged for this week. Drag on the calendar above, or sync your PADT conflict calendar.
            </li>
          )}
          {weekConflicts.map((conflict) => (
            <li
              key={conflict.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm bg-surface"
            >
              <div className="flex flex-col">
                <span className="font-medium text-ink">
                  {conflict.title || "Conflict"}
                </span>
                <span className="text-xs text-ink-soft">
                  {timeFormatter.format(conflict.startDateTime)} –{" "}
                  {timeFormatter.format(conflict.endDateTime)}
                  {conflict.sourceGoogleEventId && " · from Google Calendar"}
                  {conflict.isRecurring && " · repeats weekly"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <ConflictStatusBadge status={conflict.status} />
                <form action={deleteConflict.bind(null, conflict.id)}>
                  <button
                    type="submit"
                    className="text-xs font-medium text-ink-faint transition-colors hover:text-bad"
                  >
                    Delete
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      
    </div>
  );
}
