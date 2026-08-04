"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getLinkableCalendars,
  resyncTeamCalendar,
  setTeamCalendar,
} from "@/lib/actions/spaces";
import type { GoogleCalendarSummary } from "@/lib/google-calendar";

/** Points the app at the shared PADT calendar. Everything published lands
 * there automatically from then on, and edits follow — there's no separate
 * "push to calendar" step. */
export function TeamCalendarLink({
  linkedName,
}: {
  linkedName: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [calendars, setCalendars] = useState<GoogleCalendarSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    startTransition(async () => {
      const result = await getLinkableCalendars();
      if ("error" in result) setError(result.error);
      else setCalendars(result.calendars);
    });
  }

  function link(formData: FormData) {
    const id = String(formData.get("calendarId") ?? "");
    formData.set("calendarName", calendars?.find((c) => c.id === id)?.name ?? "");
    startTransition(async () => {
      await setTeamCalendar(formData);
      setCalendars(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-ink">
        Shared team calendar
      </h2>
      <p className="text-xs text-ink-soft">
        Every practice you publish is written here as one event —{" "}
        <em>Bhangra 7</em>, located at the studio, described with who&rsquo;s
        excused, who isn&rsquo;t and who&rsquo;s coming late. Move or cancel a
        practice and the event updates itself. Use the club account&rsquo;s
        calendar, shared with you, so it outlives any one AD.
      </p>

      {calendars ? (
        <form action={link} className="flex flex-wrap items-center gap-2">
          <select
            name="calendarId"
            required
            defaultValue=""
            className="rounded-lg border border-line-strong px-2 py-1.5 text-sm bg-surface"
          >
            <option value="" disabled>
              Pick the shared PADT calendar…
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
      ) : linkedName ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-ink-soft">
            Writing to <span className="font-medium">{linkedName}</span>
          </span>
          <button
            onClick={() =>
              startTransition(async () => {
                const written = await resyncTeamCalendar();
                setMessage(
                  `Rewrote ${written} upcoming practice${written === 1 ? "" : "s"}`,
                );
                router.refresh();
              })
            }
            disabled={isPending}
            className="rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-surface-3 disabled:opacity-45"
          >
            {isPending ? "Syncing…" : "Resync everything upcoming"}
          </button>
          <button
            onClick={load}
            disabled={isPending}
            className="text-xs font-medium text-ink-soft hover:underline"
          >
            Change calendar
          </button>
        </div>
      ) : (
        <button
          onClick={load}
          disabled={isPending}
          className="self-start rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-45"
        >
          {isPending ? "Loading…" : "Link the team calendar"}
        </button>
      )}

      {message && (
        <p className="text-xs font-medium text-good">
          {message}
        </p>
      )}
      {error && (
        <p className="text-xs font-medium text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
