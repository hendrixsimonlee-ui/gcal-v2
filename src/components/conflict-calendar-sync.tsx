"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getMyCalendars,
  setConflictCalendar,
  syncConflictCalendar,
} from "@/lib/actions/conflicts";
import type { GoogleCalendarSummary } from "@/lib/google-calendar";

/** A whole term, so one tap covers the season. The dedicated conflict
 * calendar only pays off if syncing it is a single action. */
const TERM_WEEKS = 18;

/** Point the app at the PADT conflict calendar this person was given at the
 * start of the year, then keep it in sync. Without this the app reads their
 * primary calendar, which is full of everything except their conflicts. */
export function ConflictCalendarSync({
  linkedCalendarName,
  weekStartIso,
}: {
  linkedCalendarName: string | null;
  weekStartIso: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [calendars, setCalendars] = useState<GoogleCalendarSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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

  function sync(weeks: number, label: string) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await syncConflictCalendar(weekStartIso, weeks);
        setMessage(
          `${label}: ${result.added} added · ${result.updated} updated · ${result.removed} removed`,
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sync failed");
      }
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {calendars ? (
        <form action={choose} className="flex flex-wrap items-center gap-2">
          <select
            name="calendarId"
            required
            defaultValue=""
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
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
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            Use this one
          </button>
          <button
            type="button"
            onClick={() => setCalendars(null)}
            className="text-sm font-medium text-zinc-500 hover:underline"
          >
            Cancel
          </button>
        </form>
      ) : linkedCalendarName ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            Syncing from{" "}
            <span className="font-medium">{linkedCalendarName}</span>
          </span>
          <button
            onClick={() => sync(TERM_WEEKS, "Whole term")}
            disabled={isPending}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            {isPending ? "Syncing…" : "Sync the whole term"}
          </button>
          <button
            onClick={() => sync(1, "This week")}
            disabled={isPending}
            className="text-sm font-medium text-sky-600 hover:underline disabled:opacity-40 dark:text-sky-400"
          >
            Just this week
          </button>
          <button
            onClick={loadCalendars}
            disabled={isPending}
            className="text-sm font-medium text-zinc-500 hover:underline"
          >
            Change calendar
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Point this at your PADT conflict calendar and you&rsquo;ll never
            have to type a conflict twice.
          </span>
          <button
            onClick={loadCalendars}
            disabled={isPending}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            {isPending ? "Loading…" : "Choose my calendar"}
          </button>
        </div>
      )}

      {message && (
        <p className="mt-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
