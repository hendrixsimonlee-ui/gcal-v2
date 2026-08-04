import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ConflictsCalendar } from "@/components/conflicts-calendar";
import { addDays, formatWeekLabel, parseWeekParam, toDateParam } from "@/lib/dates";
import {
  addUnavailability,
  deleteConflict,
  deleteUnavailability,
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
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
});

export default async function MyConflictsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const session = await auth();
  const userId = session!.user.id;

  const weekStart = parseWeekParam(week);
  const prevWeek = toDateParam(addDays(weekStart, -7));
  const nextWeek = toDateParam(addDays(weekStart, 7));

  const [me, weekConflicts, calendarConflicts, unavailabilities, submission] =
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
      prisma.unavailability.findMany({
        where: { userId, endDate: { gte: new Date() } },
        orderBy: { startDate: "asc" },
      }),
      prisma.conflictSubmission.findUnique({
        where: { userId_weekOf: { userId, weekOf: weekStart } },
        select: { submittedAt: true },
      }),
    ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          My Conflicts
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Log every time you&rsquo;re unavailable so the AD can schedule around
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
          <div className="flex items-center gap-3">
            <Link
              href={`/conflicts?week=${prevWeek}`}
              className="rounded-lg border border-line-strong px-2 py-1 text-sm text-ink-soft hover:bg-surface-3"
            >
              ← Prev
            </Link>
            <span className="text-sm font-medium text-ink">
              Week of {formatWeekLabel(weekStart)}
            </span>
            <Link
              href={`/conflicts?week=${nextWeek}`}
              className="rounded-lg border border-line-strong px-2 py-1 text-sm text-ink-soft hover:bg-surface-3"
            >
              Next →
            </Link>
          </div>
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

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-1 font-medium text-ink">
          Out of town / fully unavailable
        </h2>
        <p className="mb-3 text-xs text-ink-soft">
          Use this instead of a regular conflict when you&rsquo;re fully out
          for a stretch of time — it removes you from scheduling
          consideration entirely for that window.
        </p>

        <ul className="mb-4 flex flex-col gap-1">
          {unavailabilities.length === 0 && (
            <li className="text-sm text-ink-soft">
              No upcoming out-of-town windows.
            </li>
          )}
          {unavailabilities.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm bg-surface"
            >
              <span>
                {dateFormatter.format(u.startDate)} –{" "}
                {dateFormatter.format(u.endDate)}
                {u.reason && (
                  <span className="ml-2 text-xs text-ink-soft">{u.reason}</span>
                )}
              </span>
              <form action={deleteUnavailability.bind(null, u.id)}>
                <button
                  type="submit"
                  className="text-xs font-medium text-ink-faint transition-colors hover:text-bad"
                >
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>

        <form
          action={addUnavailability}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-ink-soft">From</label>
            <input
              type="date"
              name="startDate"
              required
              className="rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-ink-soft">To</label>
            <input
              type="date"
              name="endDate"
              required
              className="rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-ink-soft">Reason</label>
            <input
              name="reason"
              placeholder="e.g. Out of town"
              className="w-full rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg border border-line-strong px-4 py-1.5 text-sm font-medium text-ink-soft hover:bg-surface-3"
          >
            Mark unavailable
          </button>
        </form>
      </section>
    </div>
  );
}
