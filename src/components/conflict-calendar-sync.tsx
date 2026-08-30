"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getMyCalendars,
  setConflictCalendar,
  syncConflictCalendar,
} from "@/lib/actions/conflicts";
import type { GoogleCalendarSummary } from "@/lib/google-calendar";

/** Fallback span for "the whole term" when the AD hasn't defined terms in
 * Settings yet. Once they have, the real term dates are used instead — and
 * unlike a week count, those can reach backwards as well as forwards. */
const FALLBACK_TERM_WEEKS = 18;

/** Point the app at the PADT conflict calendar this person was given at the
 * start of the year, then keep it in sync. Without this the app reads their
 * primary calendar, which is full of everything except their conflicts. */
export function ConflictCalendarSync({
  linkedCalendarName,
  weekStartIso,
  onBehalfOfUserId,
  onBehalfOfName,
}: {
  linkedCalendarName: string | null;
  weekStartIso: string;
  /** Set when an AD is doing this for somebody else, so a dancer doesn't
   * have to go and fix their own calendar. */
  onBehalfOfUserId?: string;
  onBehalfOfName?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [calendars, setCalendars] = useState<GoogleCalendarSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadCalendars() {
    setError(null);
    startTransition(async () => {
      const result = await getMyCalendars();
      if ("error" in result) setError(result.error);
      else setCalendars(result.calendars);
    });
  }

  function choose(formData: FormData) {
    const id = String(formData.get("calendarId") ?? "");
    formData.set("calendarName", calendars?.find((c) => c.id === id)?.name ?? "");
    startTransition(async () => {
      await setConflictCalendar(formData);
      setCalendars(null);
      router.refresh();
    });
  }

  function sync(weeks: number, label: string, wholeTerm = false) {
    setMessage(null);
    setDetail(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await syncConflictCalendar(weekStartIso, weeks, {
          userId: onBehalfOfUserId,
          wholeTerm,
        });
        const changed = result.added + result.updated + result.removed;
        const imported = result.added + result.updated;

        // "Nothing changed" used to be said in three very different
        // situations: genuinely up to date, an empty window, and a calendar
        // whose conflicts were all thrown away for being all-day. Only the
        // first is good news, so say which one it is.
        setMessage(
          changed === 0
            ? result.eventsSeen === 0
              ? `${label}: nothing found on that calendar.`
              : imported === 0
                ? `${label}: found things on that calendar but imported none of them.`
                : `${label}: already up to date.`
            : `${label}: ${result.added} added · ${result.updated} updated · ${result.removed} removed`,
        );

        const lines = [
          `Looked at ${result.rangeStartKey} to ${result.rangeEndKey} and found ` +
            `${result.eventsSeen} ${result.eventsSeen === 1 ? "event" : "events"}.`,
        ];
        if (result.skippedAllDay > 0) {
          lines.push(
            `${result.skippedAllDay} ${
              result.skippedAllDay === 1 ? "is an all-day entry" : "are all-day entries"
            } and can't be used: a conflict needs a start and end time, or the ` +
              `scheduler has no idea which part of the day to avoid. Give them ` +
              `real times and sync again.`,
          );
        }
        if (result.eventsSeen === 0) {
          lines.push(
            `Either your conflicts are outside that date range, or this isn't ` +
              `the calendar they're on.`,
          );
        }
        setDetail(lines);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sync failed");
      }
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      {calendars ? (
        <form action={choose} className="flex flex-wrap items-center gap-2">
          <select
            name="calendarId"
            required
            defaultValue=""
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
          >
            <option value="" disabled>
              Which one is your PADT conflict calendar?
            </option>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.primary ? " (your main calendar)" : ""}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-45"
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
      ) : linkedCalendarName ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm text-ink-soft">
            {onBehalfOfName ? `${onBehalfOfName}'s conflicts, from ` : "Syncing from "}
            <span className="font-medium">{linkedCalendarName}</span>
          </span>
          <button
            onClick={() => sync(FALLBACK_TERM_WEEKS, "Whole term", true)}
            disabled={isPending}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-45"
          >
            {isPending ? "Syncing…" : "Sync the whole term"}
          </button>
          <button
            onClick={() => sync(1, "This week")}
            disabled={isPending}
            className="text-sm font-medium text-accent-ink hover:underline disabled:opacity-45"
          >
            Just this week
          </button>
          <button
            onClick={loadCalendars}
            disabled={isPending}
            className="text-sm font-medium text-ink-soft hover:underline"
          >
            Change calendar
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm text-ink-soft">
            Point this at your PADT conflict calendar and you&rsquo;ll never
            have to type a conflict twice.
          </span>
          <button
            onClick={loadCalendars}
            disabled={isPending}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-45"
          >
            {isPending ? "Loading…" : "Choose my calendar"}
          </button>
        </div>
      )}

      {message && (
        <p className="mt-2 text-sm font-medium text-good">
          {message}
        </p>
      )}
      {detail && (
        <ul className="mt-1 flex flex-col gap-1">
          {detail.map((line, i) => (
            <li
              key={i}
              className={
                i === 0
                  ? "text-xs text-ink-soft"
                  : "rounded-lg bg-warn-soft px-2.5 py-2 text-xs text-warn"
              }
            >
              {line}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="mt-2 text-sm font-medium text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
