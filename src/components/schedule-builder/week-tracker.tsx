"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getWeekTracker,
  publishDance,
  publishWeek,
  setWeekStatus,
  type WeekStatus,
  type WeekTrackerRow,
} from "@/lib/actions/schedule";
import { formatWeekLabel } from "@/lib/dates";
import { APP_TIME_ZONE } from "@/lib/timezone";

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
});
const clockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

/** "Thu 7:00 PM – 8:30 PM". Both ends, always.
 *
 * The tracker used to print only the start, which meant the one question the
 * AD is actually asked all week — "how long is my rehearsal?" — could only be
 * answered by opening the practice. */
function timeRange(startIso: Date, endIso: Date): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return `${dayFormatter.format(start)} ${clockFormatter.format(
    start,
  )} – ${clockFormatter.format(end)}`;
}

function minutesBetween(start: Date, end: Date): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
}

/** Work still to do is amber, not red. Red is for something that has gone
 * wrong; a dance nobody has scheduled yet at the start of the week is just
 * the job in front of you, and colouring the whole list red on Monday makes
 * the one thing that IS wrong impossible to spot. */
const STATUS_STYLES: Record<WeekStatus, { label: string; className: string }> = {
  PUBLISHED: { label: "Published", className: "bg-good-soft text-good" },
  DRAFT: { label: "Draft", className: "bg-info-soft text-info" },
  EMPTY: { label: "Needs scheduling", className: "bg-warn-soft text-warn" },
  NOT_PRACTISING: {
    label: "Not practising",
    className: "bg-surface-3 text-ink-soft",
  },
};

export function WeekTracker({
  weekOf,
  refreshKey,
  selectedDanceId,
  onPickDance,
}: {
  weekOf: Date;
  refreshKey: number;
  selectedDanceId: string;
  onPickDance: (danceId: string) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<WeekTrackerRow[]>([]);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmMissing, setConfirmMissing] = useState<string[] | null>(null);
  const weekOfIso = weekOf.toISOString();

  useEffect(() => {
    let cancelled = false;
    getWeekTracker(weekOfIso).then((result) => {
      if (!cancelled) setRows(result);
    });
    return () => {
      cancelled = true;
    };
  }, [weekOfIso, refreshKey]);

  function run(fn: () => Promise<string | null>) {
    setError(null);
    startTransition(async () => {
      try {
        const note = await fn();
        setRows(await getWeekTracker(weekOfIso));
        setMessage(note);
        router.refresh();
      } catch (e) {
        setMessage(null);
        setError(e instanceof Error ? e.message : "That didn't work.");
      }
    });
  }

  function changeStatus(row: WeekTrackerRow, next: WeekStatus) {
    if (next === row.status || next === "EMPTY") return;
    run(async () => {
      const result = await setWeekStatus(
        row.danceId,
        weekOfIso,
        next as Exclude<WeekStatus, "EMPTY">,
      );
      if (next === "PUBLISHED") {
        return result.published + result.announced === 0
          ? `${row.danceName} was already published.`
          : `${row.danceName} published — ${result.peopleNotified} ${ result.peopleNotified === 1 ? "person" : "people"
            } notified.`;
      }
      if (next === "NOT_PRACTISING") {
        return `${row.danceName} marked as sitting this week out.`;
      }
      return `${row.danceName} is back to draft. Nobody outside this screen sees it now.`;
    });
  }

  function publishOne(row: WeekTrackerRow) {
    run(async () => {
      const result = await publishDance(row.danceId, weekOfIso);
      if (result.published + result.announced === 0) {
        return `Nothing new to send for ${row.danceName}.`;
      }
      const parts: string[] = [];
      if (result.published > 0) {
        parts.push(
          `${result.published} ${result.published === 1 ? "practice" : "practices"} published`,
        );
      }
      if (result.announced > 0) {
        parts.push(
          `${result.announced} ${result.announced === 1 ? "change" : "changes"} announced`,
        );
      }
      return `${row.danceName}: ${parts.join(", ")} — ${result.peopleNotified} ${ result.peopleNotified === 1 ? "person" : "people"
      } notified.`;
    });
  }

  function publishTheWeek(force: boolean) {
    run(async () => {
      const result = await publishWeek(weekOfIso, force);
      if (result.missing.length > 0) {
        setConfirmMissing(result.missing);
        return null;
      }
      setConfirmMissing(null);
      if (result.published + result.announced === 0) {
        return "Nothing waiting to go out this week.";
      }
      return `Week published — ${result.published} new, ${result.announced} changed, ${result.peopleNotified} ${ result.peopleNotified === 1 ? "person" : "people"
      } notified.`;
    });
  }

  const done = rows.filter(
    (r) => r.status === "PUBLISHED" || r.status === "NOT_PRACTISING",
  ).length;
  const outstanding = rows.length - done;
  const stagedTotal = rows.reduce((sum, r) => sum + r.pendingChanges, 0);
  const draftTotal = rows.filter((r) => r.status === "DRAFT").length;

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
          Week of {formatWeekLabel(weekOf)}
        </h2>
        <p className="text-xs text-ink-soft">
          {rows.length === 0
            ? "No active dances."
            : outstanding === 0
              ? `All ${rows.length} dances sorted for this week.`
              : `${done} of ${rows.length} sorted · ${outstanding} still to do`}
        </p>
      </div>

      <p className="mb-3 text-xs text-ink-soft">
        Nothing here reaches the team until you publish. Drafts are yours to
        move around freely; a published practice you edit waits as{" "}
        <span className="font-medium text-warn">changed</span> until you send
        the change, so shifting a rehearsal three times still only ever costs
        one message.
      </p>

      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const style = STATUS_STYLES[row.status];
          const isSelected = row.danceId === selectedDanceId;
          return (
            <li
              key={row.danceId}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-sm ${ isSelected
                  ? "bg-surface-3 ring-1 ring-accent"
                  : "bg-surface-2"
              }`}
            >
              <span className="font-medium text-ink">{row.danceName}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.className}`}
              >
                {style.label}
              </span>
              {row.pendingChanges > 0 && (
                <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
                  {row.pendingChanges} changed, not announced
                </span>
              )}

              <span className="text-xs tabular-nums text-ink-soft">
                {row.practices.length === 0
                  ? `usually ${row.defaultDurationMinutes} min`
                  : row.practices
                      .map(
                        (p) =>
                          `${timeRange(p.startDateTime, p.endDateTime)} · ${ p.spaceName ?? "no room yet"
                          } · ${minutesBetween(p.startDateTime, p.endDateTime)} min`,
                      )
                      .join("   |   ")}
              </span>

              <span className="ml-auto flex items-center gap-3">
                <button
                  onClick={() => {
                    onPickDance(row.danceId);
                    setError(null);
                    setMessage(
                      `${row.danceName} is loaded below — pick a slot from Best times, or drag one on the grid.`,
                    );
                  }}
                  className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-on-accent hover:bg-accent-hover"
                >
                  {row.practices.length === 0 ? "Schedule it" : "Open"}
                </button>

                {(row.status === "DRAFT" || row.pendingChanges > 0) && (
                  <button
                    onClick={() => publishOne(row)}
                    disabled={isPending}
                    className="text-xs font-medium text-accent-ink hover:underline disabled:opacity-45"
                  >
                    {row.status === "DRAFT" ? "Publish this dance" : "Publish changes"}
                  </button>
                )}

                <label className="flex items-center gap-1 text-xs text-ink-soft">
                  <span className="sr-only">Status for {row.danceName}</span>
                  <select
                    value={row.status}
                    disabled={isPending}
                    onChange={(e) => changeStatus(row, e.target.value as WeekStatus)}
                    className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs disabled:opacity-45"
                  >
                    <option value="NOT_PRACTISING">Not practising this week</option>
                    <option value="DRAFT" disabled={row.status === "EMPTY"}>
                      Draft
                    </option>
                    <option value="PUBLISHED" disabled={row.status === "EMPTY"}>
                      Published
                    </option>
                    {row.status === "EMPTY" && (
                      <option value="EMPTY">Needs scheduling</option>
                    )}
                  </select>
                </label>
              </span>
            </li>
          );
        })}
      </ul>

      {rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <button
            onClick={() => publishTheWeek(false)}
            disabled={isPending || (draftTotal === 0 && stagedTotal === 0)}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-40"
          >
            {isPending ? "Publishing…" : "Publish the week"}
          </button>
          <span className="text-xs text-ink-soft">
            {draftTotal === 0 && stagedTotal === 0
              ? "Everything for this week has already gone out."
              : `${draftTotal} ${draftTotal === 1 ? "dance" : "dances"} in draft${ stagedTotal > 0 ? `, ${stagedTotal} changed since publishing` : ""
                }. Everyone affected gets one message.`}
          </span>
        </div>
      )}

      {confirmMissing && (
        <div className="mt-3 rounded-lg border border-warn/40 bg-warn-soft p-3">
          <p className="text-sm font-medium text-warn">
            {confirmMissing.join(", ")}{" "}
            {confirmMissing.length === 1 ? "has" : "have"} nothing booked this
            week.
          </p>
          <p className="mt-1 text-xs text-warn">
            If that&rsquo;s right, mark {confirmMissing.length === 1 ? "it" : "them"}{" "}
            as not practising so the cast knows it was deliberate. Publishing
            now leaves them with no answer either way.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              onClick={() => publishTheWeek(true)}
              disabled={isPending}
              className="rounded-lg bg-warn px-2.5 py-1 text-xs font-medium text-on-accent disabled:opacity-45"
            >
              Publish anyway
            </button>
            <button
              onClick={() => setConfirmMissing(null)}
              className="text-xs font-medium text-warn hover:underline"
            >
              Let me finish first
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className="mt-3 rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
    </section>
  );
}
