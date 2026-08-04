"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  clearSpacesCalendar,
  createSpaceFromReview,
  ignoreReview,
  listCalendarsForAdmin,
  mapReviewToSpace,
  renameReviewSpace,
  setSpacesCalendar,
  syncSpacesCalendar,
  type SpacesCalendarSyncResult,
} from "@/lib/actions/spaces-calendar";
import type { GoogleCalendarSummary } from "@/lib/google-calendar";
import type { TermRange } from "@/lib/terms";

export type PendingReview = {
  id: string;
  rawTitle: string;
  spaceName: string | null;
  eventCount: number;
};

/** Step one of setting up a term: point the app at the one calendar carrying
 * every room's bookings, and sync it. Each event becomes a block that room is
 * ours, and a title naming a room we don't have yet makes that room — so the
 * first sync of a term fills the schedule rather than handing back a list of
 * questions. The panel below is where those new rooms get tidied up. */
export function SpacesCalendarPanel({
  calendarName,
  terms,
  pendingReviews,
  spaces,
}: {
  calendarName: string | null;
  terms: TermRange[];
  pendingReviews: PendingReview[];
  spaces: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [calendars, setCalendars] = useState<GoogleCalendarSummary[] | null>(null);
  const [result, setResult] = useState<SpacesCalendarSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [termId, setTermId] = useState<string>(
    terms.find((t) => t.isCurrent)?.id ?? terms[0]?.id ?? "",
  );

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
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

  function choose(formData: FormData) {
    const id = String(formData.get("calendarId") ?? "");
    formData.set("calendarName", calendars?.find((c) => c.id === id)?.name ?? "");
    run(async () => {
      await setSpacesCalendar(formData);
      setCalendars(null);
    });
  }

  function sync() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await syncSpacesCalendar(termId || undefined));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sync failed");
      }
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">
          The spaces calendar
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          One calendar for every room. Each event on it means you have that
          room for that block, and the room is worked out from the event title
          — different spellings of the same room are grouped together.
        </p>
      </div>

      {calendars ? (
        <form action={choose} className="flex flex-wrap items-center gap-2">
          <select
            name="calendarId"
            required
            defaultValue=""
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
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
            Reading <span className="font-medium">{calendarName}</span>
          </span>
          {terms.length > 0 && (
            <select
              value={termId}
              onChange={(e) => setTermId(e.target.value)}
              className="rounded-lg border border-line-strong px-2 py-1.5 text-sm bg-surface"
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
              ? "Already up to date."
              : `${result.added} added · ${result.updated} updated · ${result.removed} removed`}
          </p>
          {result.skippedAllDay > 0 && (
            <p className="mt-1 text-xs text-ink-soft">
              Skipped {result.skippedAllDay} all-day{" "}
              {result.skippedAllDay === 1 ? "entry" : "entries"} — those read as
              notes rather than bookings.
            </p>
          )}
          {result.needsReview.length > 0 && (
            <p className="mt-1 text-xs text-ink-soft">
              Made {result.needsReview.length} new{" "}
              {result.needsReview.length === 1 ? "room" : "rooms"} from titles
              on the calendar —{" "}
              {result.needsReview.map((r) => r.spaceName).join(", ")}. Their
              bookings are in. Rename or merge them below if the names
              aren&rsquo;t right.
            </p>
          )}
          {result.duplicateSpaces.map((d) => (
            <p
              key={d.keptName}
              className="mt-1 text-xs text-warn"
            >
              “{d.keptName}” and {d.alsoMatching.map((n) => `“${n}”`).join(", ")}{" "}
              look like the same room. Bookings went to “{d.keptName}” — rename
              or delete the others.
            </p>
          ))}
        </div>
      )}

      {pendingReviews.length > 0 && (
        <div className="rounded-lg border border-line-strong bg-surface-2 p-3">
          <h3 className="text-sm font-semibold text-ink">
            Rooms made from calendar titles
          </h3>
          <p className="mt-1 text-xs text-ink-soft">
            These rooms and their bookings are already in — nothing is waiting
            on you. Tidy a name up, merge one into a room you already had, or
            say it isn&rsquo;t a room at all.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {pendingReviews.map((review) => (
              <li
                key={review.id}
                className="flex flex-col gap-2 rounded-lg bg-surface p-2 sm:flex-row sm:flex-wrap sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {review.spaceName ?? review.rawTitle}
                  </p>
                  <p className="truncate text-xs text-ink-soft">
                    from &ldquo;{review.rawTitle}&rdquo; ·{" "}
                    <span className="tabular-nums">{review.eventCount}</span>{" "}
                    {review.eventCount === 1 ? "booking" : "bookings"}
                  </p>
                </div>

                {review.spaceName ? (
                  <form
                    action={(fd) =>
                      run(() =>
                        renameReviewSpace(review.id, String(fd.get("name") ?? "")),
                      )
                    }
                    className="flex items-center gap-1"
                  >
                    <input
                      name="name"
                      defaultValue={review.spaceName}
                      aria-label={`Name for ${review.rawTitle}`}
                      className="w-40 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={isPending}
                      className="rounded-lg border border-line-strong px-2 py-1 text-xs font-medium text-ink-soft hover:bg-surface-2 disabled:opacity-45"
                    >
                      Rename
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => createSpaceFromReview(review.id))}
                    className="rounded-lg bg-accent px-2 py-1 text-xs font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
                  >
                    Make it a room
                  </button>
                )}

                {spaces.length > 0 && (
                  <select
                    defaultValue=""
                    disabled={isPending}
                    onChange={(e) =>
                      e.target.value &&
                      run(() => mapReviewToSpace(review.id, e.target.value))
                    }
                    className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs"
                  >
                    <option value="">Merge into…</option>
                    {spaces
                      .filter((s) => s.name !== review.spaceName)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                )}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => ignoreReview(review.id))}
                  className="text-xs font-medium text-ink-soft hover:underline disabled:opacity-45"
                >
                  Not a room
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="text-sm font-medium text-bad">
          {error}
        </p>
      )}

      <p className="text-xs text-ink-soft">
        Syncing replaces what it imported last time, so a cancelled booking
        disappears. Windows you typed in by hand are never touched.
      </p>
    </section>
  );
}
