"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  clearSpacesCalendar,
  deleteBooking,
  getWeekSpaceSummary,
  listCalendarsForAdmin,
  setSpacesCalendar,
  syncSpacesCalendar,
  updateBooking,
  type SpacesCalendarSyncResult,
  type SpaceWeekSummary,
} from "@/lib/actions/spaces-calendar";
import type { GoogleCalendarSummary } from "@/lib/google-calendar";
import type { TermRange } from "@/lib/terms";

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** "7:00 PM" from "19:00", without needing a Date. */
function pretty(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function hours(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

/** The whole Spaces screen.
 *
 * There is exactly one thing to set up — which calendar the bookings live on —
 * and then everything else is a view of it. No adding rooms, no weekly hours,
 * no closures: an event on that calendar is a room we have, and nothing else
 * is. Editing here writes back, so the calendar never goes stale. */
export function SpacesCalendarPanel({
  calendarName,
  terms,
  weekStartIso,
  weekLabel,
  prevWeek,
  nextWeek,
}: {
  calendarName: string | null;
  terms: TermRange[];
  weekStartIso: string;
  weekLabel: string;
  prevWeek: string;
  nextWeek: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [calendars, setCalendars] = useState<GoogleCalendarSummary[] | null>(null);
  const [result, setResult] = useState<SpacesCalendarSyncResult | null>(null);
  const [summary, setSummary] = useState<{
    spaces: SpaceWeekSummary[];
    totalHours: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [termId, setTermId] = useState<string>(
    terms.find((t) => t.isCurrent)?.id ?? terms[0]?.id ?? "",
  );

  useEffect(() => {
    let cancelled = false;
    getWeekSpaceSummary(weekStartIso)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [weekStartIso]);

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        setSummary(await getWeekSpaceSummary(weekStartIso));
        setEditingId(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work.");
      }
    });
  }

  function loadCalendars() {
    setError(null);
    startTransition(async () => {
      const res = await listCalendarsForAdmin();
      if ("error" in res) setError(res.error);
      else setCalendars(res.calendars);
    });
  }

  function sync() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await syncSpacesCalendar(termId || undefined));
        setSummary(await getWeekSpaceSummary(weekStartIso));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sync failed");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              The spaces calendar
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Every room the team has comes from this one calendar. An
              event&rsquo;s <span className="font-medium text-ink">title</span>{" "}
              is the room, its{" "}
              <span className="font-medium text-ink">location</span> is the
              location, and its times are when that room is ours. Book a room
              there and sync; there is nothing to set up in here.
            </p>
          </div>

          {calendars ? (
            <form
              action={(fd) => {
                const id = String(fd.get("calendarId") ?? "");
                fd.set(
                  "calendarName",
                  calendars.find((c) => c.id === id)?.name ?? "",
                );
                run(async () => {
                  await setSpacesCalendar(fd);
                  setCalendars(null);
                });
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <select
                name="calendarId"
                required
                defaultValue=""
                className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm"
              >
                <option value="" disabled>
                  Which calendar holds the room bookings?
                </option>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
              >
                Use this one
              </button>
              <button
                type="button"
                onClick={() => setCalendars(null)}
                className="text-sm font-medium text-ink-soft hover:underline"
              >
                Cancel
              </button>
            </form>
          ) : calendarName ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-sm text-ink-soft">
                Reading <span className="font-medium text-ink">{calendarName}</span>
              </span>
              {terms.length > 0 && (
                <select
                  value={termId}
                  onChange={(e) => setTermId(e.target.value)}
                  className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm"
                >
                  {terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={sync}
                disabled={isPending}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
              >
                {isPending ? "Syncing…" : "Sync this term"}
              </button>
              <button
                onClick={loadCalendars}
                disabled={isPending}
                className="text-sm font-medium text-ink-soft hover:underline disabled:opacity-45"
              >
                Change calendar
              </button>
              <button
                onClick={() => run(clearSpacesCalendar)}
                disabled={isPending}
                className="text-sm font-medium text-ink-soft hover:underline disabled:opacity-45"
              >
                Unlink
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-ink-soft">
                Link the calendar your room bookings live on and the whole
                term&rsquo;s spaces fill themselves in.
              </span>
              <button
                onClick={loadCalendars}
                disabled={isPending}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
              >
                {isPending ? "Loading…" : "Choose the calendar"}
              </button>
            </div>
          )}

          {result && (
            <div className="rounded-lg border border-line p-3 text-sm">
              <p className="font-medium text-ink">
                {result.termName ? `${result.termName}: ` : ""}
                {result.added + result.updated + result.removed === 0
                  ? "Nothing changed."
                  : `${result.added} added · ${result.updated} updated · ${result.removed} removed`}
              </p>

              {/* Always say what it looked at. "0 added" on its own can't tell
                  an empty calendar from the wrong date range from bookings
                  saved as all-day events — three different problems. */}
              <p className="mt-1 text-xs text-ink-soft">
                Looked at {result.rangeStartKey} to {result.rangeEndKey} and
                found{" "}
                <span className="font-medium tabular-nums text-ink">
                  {result.eventsSeen}
                </span>{" "}
                {result.eventsSeen === 1 ? "event" : "events"} on that calendar.
              </p>

              {result.newSpaces.length > 0 && (
                <p className="mt-1 text-xs text-ink-soft">
                  New {result.newSpaces.length === 1 ? "room" : "rooms"}:{" "}
                  {result.newSpaces.join(", ")}. If one looks like a typo, fix
                  the event title in Google and sync again.
                </p>
              )}

              {result.eventsSeen === 0 && (
                <p className="mt-2 rounded-lg bg-warn-soft px-2.5 py-2 text-xs text-warn">
                  That calendar has no events in this window. Either the
                  bookings are outside {result.rangeStartKey}–
                  {result.rangeEndKey} — check the term&rsquo;s dates in
                  Settings — or this isn&rsquo;t the calendar they&rsquo;re on.
                </p>
              )}

              {result.eventsSeen > 0 && result.added + result.updated === 0 && (
                <p className="mt-2 rounded-lg bg-warn-soft px-2.5 py-2 text-xs text-warn">
                  Found events but imported none of them.
                  {result.skippedAllDay > 0 && (
                    <>
                      {" "}
                      <span className="font-medium">
                        {result.skippedAllDay} are all-day entries.
                      </span>{" "}
                      A room booking has to have a start and end time — an
                      all-day event doesn&rsquo;t say when the room is
                      actually yours, so it&rsquo;s read as a note. Give them
                      real times and sync again.
                    </>
                  )}
                  {result.skippedNoTitle > 0 &&
                    ` ${result.skippedNoTitle} have no title, and the title is the room name.`}
                  {result.skippedZeroLength > 0 &&
                    ` ${result.skippedZeroLength} start and end at the same moment.`}
                </p>
              )}

              {result.added + result.updated > 0 && result.skippedAllDay > 0 && (
                <p className="mt-1 text-xs text-ink-soft">
                  Skipped {result.skippedAllDay} all-day{" "}
                  {result.skippedAllDay === 1 ? "entry" : "entries"} — those read
                  as notes rather than bookings.
                </p>
              )}
              {result.skippedCancelled > 0 && (
                <p className="mt-1 text-xs text-ink-soft">
                  Ignored {result.skippedCancelled} cancelled{" "}
                  {result.skippedCancelled === 1 ? "event" : "events"}.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm font-medium text-bad">{error}</p>}
        </section>

        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-ink">
              Week of {weekLabel}
            </h2>
            <div className="ml-auto flex items-center gap-2">
              <a
                href={`/admin/spaces?week=${prevWeek}`}
                className="rounded-lg border border-line-strong px-2 py-1 text-sm text-ink-soft hover:bg-surface-3"
              >
                ←
              </a>
              <a
                href={`/admin/spaces?week=${nextWeek}`}
                className="rounded-lg border border-line-strong px-2 py-1 text-sm text-ink-soft hover:bg-surface-3"
              >
                →
              </a>
            </div>
          </div>

          {!summary ? (
            <p className="text-sm text-ink-soft">Loading this week&rsquo;s rooms…</p>
          ) : summary.spaces.length === 0 ? (
            <p className="text-sm text-ink-soft">
              No rooms booked this week. Add events to the spaces calendar and
              sync.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {summary.spaces.map((space) => (
                <div key={space.spaceId}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h3 className="font-medium text-ink">{space.spaceName}</h3>
                    {space.location && (
                      <span className="text-xs text-ink-soft">
                        {space.location}
                      </span>
                    )}
                    <span className="ml-auto text-xs tabular-nums text-ink-soft">
                      {hours(space.totalHours)}{" "}
                      {space.totalHours === 1 ? "hour" : "hours"} this week
                    </span>
                  </div>
                  <ul className="mt-1 flex flex-col gap-1">
                    {space.blocks.map((block) =>
                      editingId === block.id ? (
                        <li
                          key={block.id}
                          className="rounded-lg bg-surface-2 px-3 py-2"
                        >
                          <form
                            action={(fd) =>
                              run(() =>
                                updateBooking(block.id, {
                                  dateKey: String(fd.get("date") ?? ""),
                                  startTime: String(fd.get("start") ?? ""),
                                  endTime: String(fd.get("end") ?? ""),
                                  spaceName: String(fd.get("room") ?? ""),
                                }),
                              )
                            }
                            className="flex flex-wrap items-end gap-2 text-sm"
                          >
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-ink-soft">Room</span>
                              <input
                                name="room"
                                defaultValue={space.spaceName}
                                className="w-44 rounded-lg border border-line-strong bg-surface px-2 py-1"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-ink-soft">Date</span>
                              <input
                                type="date"
                                name="date"
                                defaultValue={block.dateKey}
                                className="rounded-lg border border-line-strong bg-surface px-2 py-1"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-ink-soft">From</span>
                              <input
                                type="time"
                                name="start"
                                defaultValue={block.startTime}
                                className="rounded-lg border border-line-strong bg-surface px-2 py-1"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-ink-soft">To</span>
                              <input
                                type="time"
                                name="end"
                                defaultValue={block.endTime}
                                className="rounded-lg border border-line-strong bg-surface px-2 py-1"
                              />
                            </label>
                            <button
                              type="submit"
                              disabled={isPending}
                              className="rounded-lg bg-accent px-3 py-1 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="text-ink-soft hover:underline"
                            >
                              Cancel
                            </button>
                            <p className="w-full text-xs text-ink-soft">
                              Saving updates the Google event too, so the
                              calendar and the app can&rsquo;t disagree.
                            </p>
                          </form>
                        </li>
                      ) : (
                        <li
                          key={block.id}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-2 px-3 py-1.5 text-sm"
                        >
                          <span className="tabular-nums text-ink">
                            {dayFormatter.format(
                              new Date(`${block.dateKey}T00:00:00Z`),
                            )}
                          </span>
                          <span className="tabular-nums text-ink-soft">
                            {pretty(block.startTime)} – {pretty(block.endTime)}
                          </span>
                          <button
                            onClick={() => setEditingId(block.id)}
                            className="ml-auto text-xs font-medium text-accent-ink hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              if (
                                !confirm(
                                  `Remove ${space.spaceName} on ${block.dateKey}? This deletes the event from the spaces calendar too.`,
                                )
                              )
                                return;
                              run(() => deleteBooking(block.id));
                            }}
                            disabled={isPending}
                            className="text-xs font-medium text-ink-faint transition-colors hover:text-bad disabled:opacity-45"
                          >
                            Remove
                          </button>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* The sidebar summary: what have we got, and how much of it. */}
      <aside className="shrink-0 rounded-lg border border-line bg-surface p-4 lg:w-72">
        <h2 className="text-sm font-semibold text-ink">This week at a glance</h2>
        <p className="mt-0.5 text-xs text-ink-soft">Week of {weekLabel}</p>

        {!summary || summary.spaces.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">Nothing booked yet.</p>
        ) : (
          <>
            <p className="mt-3 text-2xl font-semibold tabular-nums text-ink">
              {hours(summary.totalHours)}
              <span className="ml-1 text-sm font-normal text-ink-soft">
                hours of floor
              </span>
            </p>
            <p className="text-xs text-ink-soft">
              across {summary.spaces.length}{" "}
              {summary.spaces.length === 1 ? "room" : "rooms"}
            </p>

            <ul className="mt-3 flex flex-col divide-y divide-line">
              {summary.spaces.map((space) => (
                <li key={space.spaceId} className="py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink">
                      {space.spaceName}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-ink-soft">
                      {hours(space.totalHours)}h
                    </span>
                  </div>
                  {space.location && (
                    <p className="truncate text-xs text-ink-faint">
                      {space.location}
                    </p>
                  )}
                  <ul className="mt-0.5 flex flex-col text-xs tabular-nums text-ink-soft">
                    {space.blocks.map((block) => (
                      <li key={block.id} className="truncate">
                        {dayFormatter.format(
                          new Date(`${block.dateKey}T00:00:00Z`),
                        )}{" "}
                        {pretty(block.startTime)}–{pretty(block.endTime)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}
