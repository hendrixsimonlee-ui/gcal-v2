import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ConflictCategorySelect } from "@/components/conflict-category-select";
import { ConflictsCalendar } from "@/components/conflicts-calendar";
import { addDays, formatWeekLabel, parseWeekParam, toDateParam } from "@/lib/dates";
import {
  addUnavailability,
  deleteConflict,
  deleteUnavailability,
  importGoogleCalendarWeek,
  updateConflictCategory,
} from "@/lib/actions/conflicts";

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
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

  const [weekConflicts, calendarConflicts, categories, unavailabilities] =
    await Promise.all([
      prisma.conflict.findMany({
        where: { userId, weekOf: weekStart },
        orderBy: { startDateTime: "asc" },
        include: { category: true },
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
        include: { category: true },
      }),
      prisma.conflictCategory.findMany({ orderBy: { name: "asc" } }),
      prisma.unavailability.findMany({
        where: { userId, endDate: { gte: new Date() } },
        orderBy: { startDate: "asc" },
      }),
    ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          My Conflicts
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Log every time you&rsquo;re unavailable so the AD can schedule around
          it.
        </p>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <ConflictsCalendar
          categories={categories.map((c) => ({
            id: c.id,
            name: c.name,
            isExcused: c.isExcused,
          }))}
          conflicts={calendarConflicts.map((c) => ({
            id: c.id,
            startDateTime: c.startDateTime.toISOString(),
            endDateTime: c.endDateTime.toISOString(),
            note: c.note,
            categoryName: c.category?.name ?? null,
            isExcused: c.category?.isExcused ?? false,
            isRecurring: c.isRecurring,
            fromGoogle: !!c.sourceGoogleEventId,
          }))}
        />
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Link
              href={`/conflicts?week=${prevWeek}`}
              className="rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              ← Prev
            </Link>
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              Week of {formatWeekLabel(weekStart)}
            </span>
            <Link
              href={`/conflicts?week=${nextWeek}`}
              className="rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Next →
            </Link>
          </div>
          <form
            action={importGoogleCalendarWeek.bind(null, weekStart.toISOString())}
          >
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Import from Google Calendar
            </button>
          </form>
        </div>

        <ul className="flex flex-col gap-1">
          {weekConflicts.length === 0 && (
            <li className="text-sm text-zinc-500">
              No conflicts logged for this week yet.
            </li>
          )}
          {weekConflicts.map((conflict) => (
            <li
              key={conflict.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800"
            >
              <div className="flex flex-col">
                <span className="text-zinc-800 dark:text-zinc-200">
                  {timeFormatter.format(conflict.startDateTime)} –{" "}
                  {timeFormatter.format(conflict.endDateTime)}
                  {conflict.sourceGoogleEventId && (
                    <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                      Google Calendar
                    </span>
                  )}
                  {conflict.isRecurring && (
                    <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                      Recurring
                    </span>
                  )}
                </span>
                {conflict.note && (
                  <span className="text-xs text-zinc-500">{conflict.note}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <ConflictCategorySelect
                  action={updateConflictCategory.bind(null, conflict.id)}
                  categories={categories}
                  defaultCategoryId={conflict.categoryId ?? ""}
                  isExcused={conflict.category?.isExcused}
                />
                <form action={deleteConflict.bind(null, conflict.id)}>
                  <button
                    type="submit"
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-1 font-medium text-zinc-900 dark:text-zinc-50">
          Out of town / fully unavailable
        </h2>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Use this instead of a regular conflict when you&rsquo;re fully out
          for a stretch of time — it removes you from scheduling
          consideration entirely for that window.
        </p>

        <ul className="mb-4 flex flex-col gap-1">
          {unavailabilities.length === 0 && (
            <li className="text-sm text-zinc-500">
              No upcoming out-of-town windows.
            </li>
          )}
          {unavailabilities.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800"
            >
              <span>
                {dateFormatter.format(u.startDate)} –{" "}
                {dateFormatter.format(u.endDate)}
                {u.reason && (
                  <span className="ml-2 text-xs text-zinc-500">{u.reason}</span>
                )}
              </span>
              <form action={deleteUnavailability.bind(null, u.id)}>
                <button
                  type="submit"
                  className="text-xs font-medium text-red-600 hover:underline"
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
            <label className="text-xs font-medium text-zinc-500">From</label>
            <input
              type="date"
              name="startDate"
              required
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500">To</label>
            <input
              type="date"
              name="endDate"
              required
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500">Reason</label>
            <input
              name="reason"
              placeholder="e.g. Out of town"
              className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </div>
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Mark unavailable
          </button>
        </form>
      </section>
    </div>
  );
}
