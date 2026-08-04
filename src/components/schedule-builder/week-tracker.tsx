"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getWeekTracker, type WeekTrackerRow } from "@/lib/actions/schedule";
import { setDanceWeekOff } from "@/lib/actions/dances";
import { formatWeekLabel } from "@/lib/dates";
import { APP_TIME_ZONE } from "@/lib/timezone";

const slotFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
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

/** Work still to do is amber, not red. Red is for something that has gone
 * wrong; a dance nobody has scheduled yet at the start of the week is just
 * the job in front of you, and colouring the whole list red on Monday makes
 * the one thing that IS wrong impossible to spot. */
const STATE_STYLES: Record<RowState, { label: string; className: string }> = {
  scheduled: {
    label: "Scheduled",
    className: "bg-good-soft text-good",
  },
  "needs-room": {
    label: "No room yet",
    className: "bg-warn-soft text-warn",
  },
  todo: {
    label: "Needs scheduling",
    className: "bg-warn-soft text-warn",
  },
  "week-off": {
    label: "Sitting out this week",
    className: "bg-surface-3 text-ink-soft",
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

      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const state = rowState(row);
          const style = STATE_STYLES[state];
          const isSelected = row.danceId === selectedDanceId;
          return (
            <li
              key={row.danceId}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-sm ${ isSelected
                  ? "bg-surface-3 ring-1 ring-line dark:ring-line"
                  : "bg-surface-2 bg-surface-3/50"
              }`}
            >
              <span className="font-medium text-ink">
                {row.danceName}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.className}`}
              >
                {style.label}
              </span>

              <span className="text-xs text-ink-soft">
                {row.practices.length === 0
                  ? `usually ${row.defaultDurationMinutes} min`
                  : row.practices
                      .map(
                        (p) =>
                          `${slotFormatter.format(new Date(p.startDateTime))} · ${ p.spaceName ?? "no room"
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
                    className="text-xs font-medium text-accent hover:underline"
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
                  className="text-xs font-medium text-ink-soft hover:underline disabled:opacity-30 disabled:hover:no-underline"
                >
                  {row.weekOff ? "Bring back this week" : "Mark as sitting out"}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
