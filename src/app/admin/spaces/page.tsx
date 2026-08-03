import { prisma } from "@/lib/prisma";
import { DAY_NAMES } from "@/lib/constants";
import {
  addSpace,
  addRecurringAvailability,
  addDateOverride,
  deleteAvailability,
  deleteSpace,
} from "@/lib/actions/spaces";
import { SpaceAvailabilityCalendar } from "@/components/space-availability-calendar";
import { SpaceCalendarLink } from "@/components/space-calendar-link";
import {
  calendarDateFormatter,
  calendarWeekStartKey,
  formatCalendarWeekLabel,
} from "@/lib/dates";

const SPACE_COLORS = ["#0ea5e9", "#a855f7", "#22c55e", "#f97316", "#eab308"];

type OverrideRow = {
  id: string;
  date: Date | null;
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
  sourceGoogleEventId: string | null;
};

/** One-off changes read as a wall of dates otherwise. The AD works a week at
 * a time, so they're grouped that way. */
function groupByWeek(overrides: OverrideRow[]) {
  const weeks = new Map<string, OverrideRow[]>();
  for (const row of overrides) {
    const key = calendarWeekStartKey(row.date!);
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key)!.push(row);
  }
  return Array.from(weeks.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, rows]) => ({
      weekKey,
      label: formatCalendarWeekLabel(weekKey),
      rows: rows.sort(
        (a, b) => a.date!.getTime() - b.date!.getTime(),
      ),
    }));
}

export default async function SpacesPage() {
  const spaces = await prisma.space.findMany({
    orderBy: { name: "asc" },
    include: { availabilities: { orderBy: { dayOfWeek: "asc" } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Spaces
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Set the usual weekly hours once, then add one-off changes for the
          weeks that differ — a closure, or unusual hours. The calendar shows
          what the scheduler will actually treat as bookable.
        </p>
      </div>

      {spaces.length > 0 && (
        <SpaceAvailabilityCalendar
          spaces={spaces.map((space, i) => ({
            spaceId: space.id,
            spaceName: space.name,
            color: SPACE_COLORS[i % SPACE_COLORS.length],
            recurring: space.availabilities
              .filter((a) => a.dayOfWeek !== null && a.startTime && a.endTime)
              .map((a) => ({
                dayOfWeek: a.dayOfWeek!,
                startTime: a.startTime!,
                endTime: a.endTime!,
              })),
            overrides: space.availabilities
              .filter((a) => a.date !== null)
              .map((a) => ({
                id: a.id,
                date: a.date!.toISOString(),
                isAvailable: a.isAvailable,
                startTime: a.startTime,
                endTime: a.endTime,
              })),
          }))}
        />
      )}

      <form
        action={addSpace}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">
            Space name
          </label>
          <input
            name="name"
            required
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">
            Location
          </label>
          <input
            name="location"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
        >
          Add space
        </button>
      </form>

      <div className="flex flex-col gap-4">
        {spaces.map((space) => (
          <section
            key={space.id}
            className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-medium text-zinc-900 dark:text-zinc-50">
                  {space.name}
                </h2>
                {space.location && (
                  <p className="text-xs text-zinc-500">{space.location}</p>
                )}
              </div>
              <form action={deleteSpace.bind(null, space.id)}>
                <button
                  type="submit"
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Delete space
                </button>
              </form>
            </div>

            <SpaceCalendarLink
              spaceId={space.id}
              linkedCalendarName={space.googleCalendarName}
            />

            <p className="mb-1 text-xs font-medium uppercase text-zinc-400">
              Usual weekly hours
            </p>
            <ul className="mb-3 flex flex-col gap-1">
              {space.availabilities.filter((a) => a.dayOfWeek !== null).length ===
                0 && (
                <li className="text-sm text-zinc-500">
                  No weekly hours set yet.
                </li>
              )}
              {space.availabilities
                .filter((a) => a.dayOfWeek !== null)
                .map((slot) => (
                  <li
                    key={slot.id}
                    className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-1.5 text-sm dark:bg-zinc-800"
                  >
                    <span>
                      {DAY_NAMES[slot.dayOfWeek!]} {slot.startTime}–{slot.endTime}
                    </span>
                    <form action={deleteAvailability.bind(null, slot.id)}>
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

            <p className="mb-1 text-xs font-medium uppercase text-zinc-400">
              One-off changes
            </p>
            {space.availabilities.filter((a) => a.date !== null).length === 0 ? (
              <p className="mb-3 text-sm text-zinc-500">
                None — every week follows the usual hours.
              </p>
            ) : (
              <div className="mb-3 flex flex-col gap-2">
                {groupByWeek(
                  space.availabilities.filter((a) => a.date !== null),
                ).map((week) => (
                  <div key={week.weekKey}>
                    <p className="mb-1 text-xs font-medium text-zinc-500">
                      Week of {week.label}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {week.rows.map((slot) => (
                        <li
                          key={slot.id}
                          className={`flex items-center justify-between rounded-md px-3 py-1.5 text-sm ${
                            slot.isAvailable
                              ? "bg-sky-50 dark:bg-sky-950"
                              : "bg-red-50 dark:bg-red-950"
                          }`}
                        >
                          <span>
                            {calendarDateFormatter.format(slot.date!)} —{" "}
                            {slot.isAvailable
                              ? `open ${slot.startTime}–${slot.endTime}`
                              : "closed all day"}
                            {slot.sourceGoogleEventId && (
                              <span className="ml-2 rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                                from Google
                              </span>
                            )}
                          </span>
                          <form action={deleteAvailability.bind(null, slot.id)}>
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
                  </div>
                ))}
              </div>
            )}

            <form
              action={addRecurringAvailability.bind(null, space.id)}
              className="flex flex-wrap items-end gap-2"
            >
              <select
                name="dayOfWeek"
                required
                className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              >
                {DAY_NAMES.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
              <input
                type="time"
                name="startTime"
                required
                className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
              <span className="text-sm text-zinc-500">to</span>
              <input
                type="time"
                name="endTime"
                required
                className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Add weekly window
              </button>
            </form>

            <form
              action={addDateOverride.bind(null, space.id)}
              className="mt-2 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800"
            >
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500">
                  One-off date
                </label>
                <input
                  type="date"
                  name="date"
                  required
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" name="closed" />
                Closed all day
              </label>
              <input
                type="time"
                name="startTime"
                aria-label="Replacement start time"
                className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
              <span className="text-sm text-zinc-500">to</span>
              <input
                type="time"
                name="endTime"
                aria-label="Replacement end time"
                className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Add one-off change
              </button>
            </form>
          </section>
        ))}
      </div>
    </div>
  );
}
