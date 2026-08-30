"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getDancerCalendars,
  listCalendarsVisibleToAdmin,
  setConflictCalendarForUser,
  syncAllDancerCalendars,
  syncConflictCalendar,
  type DancerCalendarRow,
} from "@/lib/actions/conflicts";
import type { GoogleCalendarSummary } from "@/lib/google-calendar";
import { APP_TIME_ZONE } from "@/lib/timezone";

const stampFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Where the AD wires each dancer to the conflict calendar they shared with
 * the club account, and pulls the whole term in one go. */
export function DancerCalendars({
  initialRows,
  termName,
}: {
  initialRows: DancerCalendarRow[];
  termName: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [calendars, setCalendars] = useState<GoogleCalendarSummary[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<string | null>) {
    setError(null);
    startTransition(async () => {
      try {
        const note = await fn();
        setRows(await getDancerCalendars());
        setMessage(note);
        router.refresh();
      } catch (e) {
        setMessage(null);
        setError(e instanceof Error ? e.message : "That didn't work.");
      }
    });
  }

  function loadCalendars() {
    setError(null);
    startTransition(async () => {
      const res = await listCalendarsVisibleToAdmin();
      if ("error" in res) setError(res.error);
      else setCalendars(res.calendars);
    });
  }

  const linked = rows.filter((r) => r.calendarId).length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Dancer Calendars</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Everyone makes a PADT conflict calendar and shares it with the club
          Google account. Once it&rsquo;s shared, it shows up in the list here
          and you can attach it to them yourself — they never have to sign in
          and go hunting for a setting.
        </p>
      </div>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">
          What to tell the team
        </h2>
        <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm text-ink-soft">
          <li>
            In Google Calendar, make a calendar called{" "}
            <span className="font-medium text-ink">PADT — your name</span>.
          </li>
          <li>
            Put every class, job shift and commitment that stops you rehearsing
            on it. Recurring events are fine — they come through as one
            conflict per week.
          </li>
          <li>
            Settings for that calendar → Share with specific people → add the
            club account with <span className="font-medium text-ink">See all event details</span>.
          </li>
        </ol>
        <p className="mt-2 text-xs text-ink-soft">
          Read-only access is enough. Nothing here ever writes to a
          dancer&rsquo;s calendar.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        <span className="text-sm text-ink-soft">
          <span className="font-medium tabular-nums text-ink">{linked}</span> of{" "}
          <span className="tabular-nums">{rows.length}</span> linked
        </span>
        <button
          onClick={loadCalendars}
          disabled={isPending}
          className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-surface-2 disabled:opacity-45"
        >
          {calendars ? "Refresh the shared list" : "Load shared calendars"}
        </button>
        <button
          onClick={() =>
            run(async () => {
              const result = await syncAllDancerCalendars();
              const base = `Synced ${result.synced} ${ result.synced === 1 ? "calendar" : "calendars"
              } — ${result.added} new conflicts imported${ termName ? ` for ${termName}` : ""
              }.`;
              return result.failures.length === 0
                ? base
                : `${base} Couldn't reach: ${result.failures
                    .map((f) => `${f.name} (${f.reason})`)
                    .join("; ")}`;
            })
          }
          disabled={isPending || linked === 0}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
        >
          {isPending ? "Syncing…" : "Sync everyone for the term"}
        </button>
        {!calendars && (
          <span className="text-xs text-ink-soft">
            Load the list first to attach a calendar to someone.
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-surface-2 text-left text-xs font-medium uppercase text-ink-soft">
            <tr>
              <th className="px-4 py-2">Dancer</th>
              <th className="px-4 py-2">Calendar</th>
              <th className="px-4 py-2">Imported this term</th>
              <th className="px-4 py-2">Last change</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.userId}>
                <td className="px-4 py-2">
                  <span className="font-medium text-ink">{row.name}</span>
                  <span className="block text-xs text-ink-faint">
                    {row.email}
                  </span>
                  {/* Someone who skipped the calendar tick-boxes looks
                      completely normal everywhere else, so flag it here —
                      otherwise it surfaces as a rehearsal booked on top of
                      their midterm. */}
                  {row.grantedCalendarAccess === false && (
                    <span className="mt-0.5 block text-xs font-medium text-bad">
                      Didn&rsquo;t grant calendar access — needs to sign out
                      and back in, ticking the calendar boxes
                    </span>
                  )}
                  {row.grantedCalendarAccess === null && (
                    <span className="mt-0.5 block text-xs text-warn">
                      Hasn&rsquo;t signed in yet
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {calendars ? (
                    <select
                      value={row.calendarId ?? ""}
                      disabled={isPending}
                      onChange={(e) => {
                        const id = e.target.value;
                        const name =
                          calendars.find((c) => c.id === id)?.name ?? "";
                        run(async () => {
                          await setConflictCalendarForUser(row.userId, id, name);
                          return id
                            ? `${row.name} is now reading ${name}.`
                            : `${row.name} has no calendar linked.`;
                        });
                      }}
                      className="w-56 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs"
                    >
                      <option value="">Not linked</option>
                      {calendars.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : row.calendarName ? (
                    <span className="text-xs text-good">{row.calendarName}</span>
                  ) : (
                    <span className="text-xs text-warn">Not linked</span>
                  )}
                </td>
                <td className="px-4 py-2 tabular-nums text-ink-soft">
                  {row.conflictsInTerm}
                </td>
                <td className="px-4 py-2 text-xs text-ink-soft">
                  {row.lastSyncedIso
                    ? stampFormatter.format(new Date(row.lastSyncedIso))
                    : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  {row.calendarId && (
                    <button
                      onClick={() =>
                        run(async () => {
                          const result = await syncConflictCalendar("", 0, {
                            userId: row.userId,
                            wholeTerm: true,
                          });
                          return `${row.name}: ${result.added} added, ${result.updated} updated, ${result.removed} removed.`;
                        })
                      }
                      disabled={isPending}
                      className="text-xs font-medium text-accent-ink hover:underline disabled:opacity-45"
                    >
                      Sync
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {message && (
        <p className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
          {message}
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
