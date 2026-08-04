"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getLinkableCalendars,
  importSpaceCalendar,
  linkSpaceCalendar,
  unlinkSpaceCalendar,
} from "@/lib/actions/spaces";
import type { GoogleCalendarSummary } from "@/lib/google-calendar";

/** Links a room to the Google Calendar its bookings live on, and syncs them
 * in. The calendar list is fetched on demand rather than on page load — most
 * visits to this page have nothing to do with Google, and the round-trip is
 * slow enough to notice. */
export function SpaceCalendarLink({
  spaceId,
  linkedCalendarName,
}: {
  spaceId: string;
  linkedCalendarName: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [calendars, setCalendars] = useState<GoogleCalendarSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadCalendars() {
    setError(null);
    startTransition(async () => {
      const result = await getLinkableCalendars();
      if ("error" in result) setError(result.error);
      else setCalendars(result.calendars);
    });
  }

  function link(formData: FormData) {
    const calendarId = String(formData.get("calendarId") ?? "");
    const chosen = calendars?.find((c) => c.id === calendarId);
    formData.set("calendarName", chosen?.name ?? "");
    startTransition(async () => {
      await linkSpaceCalendar(spaceId, formData);
      setCalendars(null);
      router.refresh();
    });
  }

  function sync() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await importSpaceCalendar(spaceId);
        const parts = [
          `${result.added} added`,
          `${result.updated} updated`,
          `${result.removed} removed`,
        ];
        if (result.skippedAllDay > 0) {
          parts.push(`${result.skippedAllDay} all-day event${result.skippedAllDay === 1 ? "" : "s"} skipped`);
        }
        setMessage(parts.join(" · "));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Import failed");
      }
    });
  }

  return (
    <div className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm bg-surface">
      {linkedCalendarName ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-ink-soft">
            Google Calendar:{" "}
            <span className="font-medium">{linkedCalendarName}</span>
          </span>
          <button
            onClick={sync}
            disabled={isPending}
            className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
          >
            {isPending ? "Syncing…" : "Sync bookings"}
          </button>
          <button
            onClick={() =>
              startTransition(async () => {
                await unlinkSpaceCalendar(spaceId);
                router.refresh();
              })
            }
            disabled={isPending}
            className="text-xs font-medium text-ink-soft hover:underline"
          >
            Unlink
          </button>
        </div>
      ) : calendars ? (
        <form action={link} className="flex flex-wrap items-center gap-2">
          <select
            name="calendarId"
            required
            defaultValue=""
            className="rounded-lg border border-line-strong px-2 py-1 text-sm"
          >
            <option value="" disabled>
              Pick the calendar this room is booked on…
            </option>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.primary ? " (your own calendar)" : ""}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
          >
            Link
          </button>
          <button
            type="button"
            onClick={() => setCalendars(null)}
            className="text-xs font-medium text-ink-soft hover:underline"
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-ink-soft">
            No Google Calendar linked. Link one and each event on it becomes a
            block this room is open.
          </span>
          <button
            onClick={loadCalendars}
            disabled={isPending}
            className="text-xs font-medium text-accent hover:underline disabled:opacity-45"
          >
            {isPending ? "Loading…" : "Link a calendar"}
          </button>
        </div>
      )}

      {message && (
        <p className="mt-1 text-xs font-medium text-good">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-1 text-xs font-medium text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
