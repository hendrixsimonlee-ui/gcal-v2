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
import { SpacesCalendarPanel } from "@/components/spaces-calendar-panel";
import { listTerms } from "@/lib/terms";
import {
  calendarDateFormatter,
  calendarWeekStartKey,
  formatCalendarWeekLabel,
} from "@/lib/dates";

/** Same reasoning as the dance colours: distinct from each other, and clear
 * of the gold accent so a shaded room never looks clickable. */
const SPACE_COLORS = ["#2563eb", "#be185d", "#0891b2", "#6d28d9", "#0f766e"];

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
  const spacesQuery = prisma.space.findMany({
    orderBy: { name: "asc" },
    include: { availabilities: { orderBy: { dayOfWeek: "asc" } } },
  });

  const [spaces, terms, settings, pendingReviews] = await Promise.all([
    spacesQuery,
    listTerms(),
    prisma.appSettings.findUnique({
      where: { id: "singleton" },
      select: { spacesCalendarName: true },
    }),
    // Rows worth showing are the ones the sync created and the AD hasn't
    // looked at yet, plus anything left unlinked (a title they reopened).
    // A row they've renamed, merged or ignored drops out on its own.
    prisma.spaceNameReview.findMany({
      where: {
        ignored: false,
        OR: [{ autoCreated: true }, { resolvedSpaceId: null }],
      },
      orderBy: { eventCount: "desc" },
      select: {
        id: true,
        rawTitle: true,
        eventCount: true,
        resolvedSpace: { select: { name: true } },
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          Spaces
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Set the usual weekly hours once, then add one-off changes for the
          weeks that differ — a closure, or unusual hours. The calendar shows
          what the scheduler will actually treat as bookable.
        </p>
      </div>

      <SpacesCalendarPanel
        calendarName={settings?.spacesCalendarName ?? null}
        terms={terms}
        pendingReviews={pendingReviews.map((r) => ({
          id: r.id,
          rawTitle: r.rawTitle,
          spaceName: r.resolvedSpace?.name ?? null,
          eventCount: r.eventCount,
        }))}
        spaces={spaces.map((s) => ({ id: s.id, name: s.name }))}
      />

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
        className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-soft">
            Space name
          </label>
          <input
            name="name"
            required
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-soft">
            Location
          </label>
          <input
            name="location"
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
        >
          Add space
        </button>
      </form>

      <div className="flex flex-col gap-4">
        {spaces.map((space) => (
          <section
            key={space.id}
            className="rounded-lg border border-line bg-surface p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-medium text-ink">
                  {space.name}
                </h2>
                {space.location && (
                  <p className="text-xs text-ink-soft">{space.location}</p>
                )}
              </div>
              <form action={deleteSpace.bind(null, space.id)}>
                <button
                  type="submit"
                  className="text-xs font-medium text-ink-faint transition-colors hover:text-bad"
                >
                  Delete space
                </button>
              </form>
            </div>

            <SpaceCalendarLink
              spaceId={space.id}
              linkedCalendarName={space.googleCalendarName}
            />

            <p className="mb-1 text-xs font-medium uppercase text-ink-faint">
              Usual weekly hours
            </p>
            <ul className="mb-3 flex flex-col gap-1">
              {space.availabilities.filter((a) => a.dayOfWeek !== null).length ===
                0 && (
                <li className="text-sm text-ink-soft">
                  No weekly hours set yet.
                </li>
              )}
              {space.availabilities
                .filter((a) => a.dayOfWeek !== null)
                .map((slot) => (
                  <li
                    key={slot.id}
                    className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-1.5 text-sm bg-surface"
                  >
                    <span>
                      {DAY_NAMES[slot.dayOfWeek!]} {slot.startTime}–{slot.endTime}
                    </span>
                    <form action={deleteAvailability.bind(null, slot.id)}>
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

            <p className="mb-1 text-xs font-medium uppercase text-ink-faint">
              One-off changes
            </p>
            {space.availabilities.filter((a) => a.date !== null).length === 0 ? (
              <p className="mb-3 text-sm text-ink-soft">
                None — every week follows the usual hours.
              </p>
            ) : (
              <div className="mb-3 flex flex-col gap-2">
                {groupByWeek(
                  space.availabilities.filter((a) => a.date !== null),
                ).map((week) => (
                  <div key={week.weekKey}>
                    <p className="mb-1 text-xs font-medium text-ink-soft">
                      Week of {week.label}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {week.rows.map((slot) => (
                        <li
                          key={slot.id}
                          className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${ slot.isAvailable
                              ? "bg-info-soft "
                              : "bg-bad-soft"
                          }`}
                        >
                          <span>
                            {calendarDateFormatter.format(slot.date!)} —{" "}
                            {slot.isAvailable
                              ? `open ${slot.startTime}–${slot.endTime}`
                              : "closed all day"}
                            {slot.sourceGoogleEventId && (
                              <span className="ml-2 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
                                from Google
                              </span>
                            )}
                          </span>
                          <form action={deleteAvailability.bind(null, slot.id)}>
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
                className="rounded-lg border border-line-strong px-2 py-1.5 text-sm bg-surface"
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
                className="rounded-lg border border-line-strong px-2 py-1.5 text-sm bg-surface"
              />
              <span className="text-sm text-ink-soft">to</span>
              <input
                type="time"
                name="endTime"
                required
                className="rounded-lg border border-line-strong px-2 py-1.5 text-sm bg-surface"
              />
              <button
                type="submit"
                className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-surface-3"
              >
                Add weekly window
              </button>
            </form>

            <form
              action={addDateOverride.bind(null, space.id)}
              className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2"
            >
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-ink-soft">
                  Close this room on
                </label>
                <input
                  type="date"
                  name="date"
                  required
                  className="rounded-lg border border-line-strong px-2 py-1.5 text-sm bg-surface"
                />
              </div>
              <button
                type="submit"
                className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-surface-3"
              >
                Close for the day
              </button>
              <p className="w-full text-xs text-ink-soft">
                A closure beats everything — the weekly hours and the spaces
                calendar both. To <em>open</em> a room, book it on the spaces
                calendar and sync; that way the booking exists somewhere real,
                not just in here.
              </p>
            </form>
          </section>
        ))}
      </div>
    </div>
  );
}
