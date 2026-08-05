"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getWeeklySubmissions,
  nudgeMissingSubmissions,
  syncConflictCalendar,
  type ConflictSubmissionRow,
} from "@/lib/actions/conflicts";
import { APP_TIME_ZONE } from "@/lib/timezone";

const stampFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** Who has said "my conflicts for this week are in" and who hasn't.
 *
 * This is the question the AD used to answer by messaging forty people
 * individually. Everyone on the roster is listed either way, because the
 * useful fact is the silence, not the submissions. */
export function SubmissionTracker({
  weekOfIso,
  weekLabel,
}: {
  weekOfIso: string;
  weekLabel: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ConflictSubmissionRow[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getWeeklySubmissions(weekOfIso).then((result) => {
      if (!cancelled) setRows(result);
    });
    return () => {
      cancelled = true;
    };
  }, [weekOfIso]);

  function run(fn: () => Promise<string | null>) {
    setError(null);
    startTransition(async () => {
      try {
        const note = await fn();
        setRows(await getWeeklySubmissions(weekOfIso));
        setMessage(note);
        router.refresh();
      } catch (e) {
        setMessage(null);
        setError(e instanceof Error ? e.message : "That didn't work.");
      }
    });
  }

  if (!rows) {
    return (
      <section className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-soft">
        Loading who&rsquo;s answered…
      </section>
    );
  }

  const submitted = rows.filter((r) => r.submittedAtIso !== null);
  const missing = rows.filter((r) => r.submittedAtIso === null);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
          Conflicts in for {weekLabel}
        </h2>
        <p className="text-xs tabular-nums text-ink-soft">
          {submitted.length} of {rows.length} answered
        </p>
      </div>

      <p className="text-xs text-ink-soft">
        Submitting is someone saying they&rsquo;ve checked their week — not the
        same as having no conflicts. Until they do, an empty week and an
        unanswered one look identical, which is how a rehearsal ends up on top
        of a midterm.
      </p>

      {missing.length > 0 && (
        <div className="rounded-lg border border-warn/35 bg-warn-soft p-3">
          <p className="text-sm font-medium text-warn">
            Still waiting on {missing.length}
          </p>
          <p className="mt-1 text-xs text-warn">
            {missing.map((m) => m.name).join(", ")}
          </p>
          <button
            onClick={() =>
              run(async () => {
                const result = await nudgeMissingSubmissions(weekOfIso);
                return result.nudged === 0
                  ? "Nobody to nudge."
                  : `Nudged ${result.nudged} ${result.nudged === 1 ? "person" : "people"} — only the ones who haven't answered.`;
              })
            }
            disabled={isPending}
            className="mt-2 rounded-lg bg-warn px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-45"
          >
            {isPending ? "Sending…" : "Nudge everyone outstanding"}
          </button>
        </div>
      )}

      <ul className="flex flex-col divide-y divide-line">
        {rows.map((row) => (
          <li
            key={row.userId}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
          >
            <span className="font-medium text-ink">{row.name}</span>
            {row.submittedAtIso ? (
              <span className="rounded-full bg-good-soft px-2 py-0.5 text-[11px] font-medium text-good">
                In · {stampFormatter.format(new Date(row.submittedAtIso))}
              </span>
            ) : (
              <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
                {row.nudgedAtIso
                  ? `Nudged ${stampFormatter.format(new Date(row.nudgedAtIso))}`
                  : "Not in yet"}
              </span>
            )}
            <span className="text-xs tabular-nums text-ink-soft">
              {row.conflictCount}{" "}
              {row.conflictCount === 1 ? "conflict" : "conflicts"} logged
            </span>
            {row.hasCalendarLinked ? (
              <button
                onClick={() =>
                  run(async () => {
                    const result = await syncConflictCalendar(weekOfIso, 1, {
                      userId: row.userId,
                    });
                    return `${row.name}: ${result.added} added, ${result.updated} updated, ${result.removed} removed.`;
                  })
                }
                disabled={isPending}
                className="ml-auto text-xs font-medium text-accent-ink hover:underline disabled:opacity-45"
              >
                Sync their calendar
              </button>
            ) : (
              <span className="ml-auto text-xs text-ink-faint">
                No calendar linked
              </span>
            )}
          </li>
        ))}
      </ul>

      {message && <p className="text-sm text-good">{message}</p>}
      {error && <p className="text-sm font-medium text-bad">{error}</p>}
    </section>
  );
}
