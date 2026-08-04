"use client";

import { useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import type { EventInput } from "@fullcalendar/core";

export interface SpaceCalendarInput {
  spaceId: string;
  spaceName: string;
  color: string;
  recurring: { dayOfWeek: number; startTime: string; endTime: string }[];
  overrides: {
    id: string;
    /** UTC-midnight ISO instant — that's how a Prisma `@db.Date` serializes,
     * so the calendar date is the first ten characters and nothing else. */
    date: string;
    isAvailable: boolean;
    startTime: string | null;
    endTime: string | null;
  }[];
}

/** Local calendar date as YYYY-MM-DD, for the real dates the grid is showing.
 * Deliberately not `toISOString()`: that would shift the day west of UTC. */
function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Shows what's actually bookable once one-off changes are applied on top of
 * the recurring pattern — the thing the AD needs to eyeball before scheduling
 * a week. A date with a one-off drops its usual hours entirely, so the
 * calendar never shows the old and the new hours for the same day at once. */
export function SpaceAvailabilityCalendar({
  spaces,
}: {
  spaces: SpaceCalendarInput[];
}) {
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null);

  const events = useMemo<EventInput[]>(() => {
    if (!range) return [];
    const result: EventInput[] = [];

    for (const space of spaces) {
      const overriddenDates = new Set(
        space.overrides.map((o) => o.date.slice(0, 10)),
      );

      // Recurring windows are expanded day by day rather than handed to
      // FullCalendar as `daysOfWeek` recurrence: a recurring event can't carry
      // exceptions, and every overridden date is an exception.
      const cursor = new Date(range.start);
      while (cursor < range.end) {
        const key = dateKey(cursor);
        if (!overriddenDates.has(key)) {
          for (const window of space.recurring) {
            if (window.dayOfWeek !== cursor.getDay()) continue;
            result.push({
              id: `${space.spaceId}-usual-${key}-${window.startTime}`,
              start: `${key}T${window.startTime}:00`,
              end: `${key}T${window.endTime}:00`,
              display: "background",
              backgroundColor: space.color,
              title: space.spaceName,
            });
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }

      for (const override of space.overrides) {
        const key = override.date.slice(0, 10);
        if (override.isAvailable && override.startTime && override.endTime) {
          result.push({
            id: `${space.spaceId}-open-${override.id}`,
            start: `${key}T${override.startTime}:00`,
            end: `${key}T${override.endTime}:00`,
            title: `${space.spaceName} — changed hours`,
            backgroundColor: space.color,
            borderColor: space.color,
          });
        } else {
          result.push({
            id: `${space.spaceId}-closed-${override.id}`,
            start: key,
            allDay: true,
            title: `${space.spaceName} — CLOSED`,
            backgroundColor: "#dc2626",
            borderColor: "#dc2626",
          });
        }
      }
    }

    return result;
  }, [spaces, range]);

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        <span className="font-medium text-ink-soft">
          Shaded = usual hours · solid block = changed hours ·
        </span>
        {spaces.map((s) => (
          <span key={s.spaceId} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded"
              style={{ backgroundColor: s.color }}
            />
            {s.spaceName}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-bad" />
          Closed all day
        </span>
      </div>
      <FullCalendar
        plugins={[timeGridPlugin, dayGridPlugin]}
        initialView="timeGridWeek"
        // Monday-first, matching the app's Monday-based weeks elsewhere.
        firstDay={1}
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "timeGridWeek,dayGridMonth",
        }}
        height="auto"
        slotMinTime="07:00:00"
        slotMaxTime="24:00:00"
        nowIndicator
        events={events}
        datesSet={(arg) =>
          setRange((prev) =>
            prev &&
            prev.start.getTime() === arg.start.getTime() &&
            prev.end.getTime() === arg.end.getTime()
              ? prev
              : { start: arg.start, end: arg.end },
          )
        }
      />
    </div>
  );
}
