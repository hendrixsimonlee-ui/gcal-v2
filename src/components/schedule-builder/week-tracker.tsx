"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getWeekTracker, type WeekTrackerRow } from "@/lib/actions/schedule";
import { setDanceWeekOff } from "@/lib/actions/dances";
import { formatWeekLabel } from "@/lib/dates";

const slotFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

function minutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

type RowState = "scheduled" | "needs-room" | "week-off" | "todo";

function rowState(row: WeekTrackerRow): RowState {
  if (row.practices.length === 0) return row.weekOff ? "week-off" : "todo";
  if (row.practices.some((p) => p.spaceName === null)) return "needs-room";
  return "scheduled";
}

const STATE_STYLES: Record<RowState, { label: string; className: string }> = {
  scheduled: {
    label: "Scheduled",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  },
  "needs-room": {
    label: "No room yet",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  },
  todo: {
    label: "Needs scheduling",
    className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  },
  "week-off": {
    label: "No practice this week",
    className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  },
};

/** The AD's checklist for one week: every active dance, whether it's booked,
 * where, for how long, and which ones are deliberately sitting the week out.
 * Answers "am I done?" without reading the calendar grid dance by dance. */
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

  function toggleWeekOff(danceId: string, currentlyOff: boolean) {
    startTransition(async () => {
      await setDanceWeekOff(danceId, weekOfIso, !currentlyOff);
      setRows(await getWeekTracker(weekOfIso));
      router.refresh();
    });
  }

  const states = rows.map(rowState);
  const done = states.filter((s) => s === "scheduled" || s === "week-off").length;
  const outstanding = rows.length - done;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Week of {formatWeekLabel(weekOf)}
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {rows.length === 0
            ? "No active dances."
            : outstanding === 0
              ? `All ${rows.length} dances sorted for this week.`
              : `${done} of ${rows.length} sorted · ${outstanding} still to do`}
        </p>
      </div>

      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const state = rowState(row);
          const style = STATE_STYLES[state];
          const isSelected = row.danceId === selectedDanceId;
          return (
            <li
              key={row.danceId}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-2 text-sm ${
                isSelected
                  ? "bg-zinc-100 ring-1 ring-zinc-300 dark:bg-zinc-800 dark:ring-zinc-600"
                  : "bg-zinc-50 dark:bg-zinc-800/50"
              }`}
            >
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {row.danceName}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.className}`}
              >
                {style.label}
              </span>

              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                {row.practices.length === 0
                  ? `usually ${row.defaultDurationMinutes} min`
                  : row.practices
                      .map(
                        (p) =>
                          `${slotFormatter.format(new Date(p.startDateTime))} · ${
                            p.spaceName ?? "no room"
                          } · ${minutesBetween(
                            new Date(p.startDateTime),
                            new Date(p.endDateTime),
                          )} min${p.status === "PROPOSED" ? " (draft)" : ""}`,
                      )
                      .join("   |   ")}
              </span>

              <span className="ml-auto flex items-center gap-3">
                {!row.weekOff && (
                  <button
                    onClick={() => onPickDance(row.danceId)}
                    className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
                  >
                    {row.practices.length === 0 ? "Schedule it" : "Open"}
                  </button>
                )}
                <button
                  onClick={() => toggleWeekOff(row.danceId, row.weekOff)}
                  disabled={isPending || row.practices.length > 0}
                  title={
                    row.practices.length > 0
                      ? "Remove this week's practices first"
                      : undefined
                  }
                  className="text-xs font-medium text-zinc-500 hover:underline disabled:opacity-30 disabled:hover:no-underline"
                >
                  {row.weekOff ? "Undo week off" : "No practice this week"}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
