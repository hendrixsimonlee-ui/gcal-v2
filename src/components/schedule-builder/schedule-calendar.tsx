"use client";

import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type {
  EventContentArg,
  EventInput,
  DateSelectArg,
  EventDropArg,
} from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import type { CandidateSlot } from "@/lib/scheduling";

export interface PracticeEvent {
  id: string;
  danceId: string;
  danceName: string;
  spaceId: string | null;
  spaceName: string | null;
  startDateTime: string;
  endDateTime: string;
  status: "PROPOSED" | "CONFIRMED";
  plannedArrivals?: { userId: string; name: string; arriveAt: string }[];
}

/** Categorical colours for dances on the grid.
 *
 * Chosen to sit away from the accent: a violet block would read as a
 * control rather than a practice. Ordered so neighbouring entries are far
 * apart in hue, because adjacent dances often land in adjacent slots. */
/** Categorical colours for dances on the grid.
 *
 * No green and no violet in here, deliberately. Green already means "this
 * room is free" on this very grid, and violet means "this is a control" —
 * a dance block in either would be read as something it isn't. */
const DANCE_COLORS = [
  "#2563eb", // blue
  "#c2410c", // burnt orange
  "#be185d", // plum
  "#0891b2", // cyan
  "#92400e", // brown
  "#475569", // slate
];

function colorForDance(danceId: string): string {
  let hash = 0;
  for (let i = 0; i < danceId.length; i++) hash = (hash * 31 + danceId.charCodeAt(i)) >>> 0;
  return DANCE_COLORS[hash % DANCE_COLORS.length];
}

export function ScheduleCalendar({
  practices,
  candidates,
  businessHours,
  datedAvailability,
  legendSpaceCount,
  onSelectRange,
  onEventMove,
  onDatesSet,
}: {
  practices: PracticeEvent[];
  candidates: CandidateSlot[];
  businessHours: { daysOfWeek: number[]; startTime: string; endTime: string }[];
  /** One-off bookable windows, which is what importing a spaces calendar
   * produces. `businessHours` can't express these. */
  datedAvailability: {
    spaceName: string;
    dateKey: string;
    startTime: string;
    endTime: string;
  }[];
  /** Only used to word the legend, so "space is free" reads correctly whether
   * one room or all of them are in view. */
  legendSpaceCount: number;
  onSelectRange: (startIso: string, endIso: string) => void;
  onEventMove: (practiceId: string, startIso: string, endIso: string) => void;
  onDatesSet: (start: Date, end: Date) => void;
}) {
  const practiceEvents: EventInput[] = practices.map((p) => {
    const color = colorForDance(p.danceId);
    return {
      id: p.id,
      title: `${p.danceName}${p.spaceName ? ` · ${p.spaceName}` : ""}`,
      start: p.startDateTime,
      end: p.endDateTime,
      backgroundColor: color,
      borderColor: color,
      classNames: p.status === "PROPOSED" ? ["opacity-60", "border-dashed"] : [],
      extendedProps: { status: p.status },
    };
  });

  // Rendered as background bands, not blocks: overlapping candidate slots as
  // regular events stack into unreadable slivers. The ranked list beside the
  // calendar is the interface for picking one; this is just the visual hint
  // of where the good windows are.
  const candidateEvents: EventInput[] = candidates.map((c, i) => ({
    id: `candidate-${i}`,
    title: `#${i + 1}`,
    start: c.startDateTime.toISOString(),
    end: c.endDateTime.toISOString(),
    display: "background",
    backgroundColor: c.score === 0 ? "#bbf7d0" : "#fef08a",
    editable: false,
  }));

  // Dated windows shade the grid the same way the weekly pattern does, so a
  // room imported from the shared calendar reads identically to one whose
  // hours were typed in by hand.
  const availabilityEvents: EventInput[] = datedAvailability.map((a) => ({
    start: `${a.dateKey}T${a.startTime}:00`,
    end: `${a.dateKey}T${a.endTime}:00`,
    display: "background",
    backgroundColor: "rgba(16, 185, 129, 0.14)",
    title: a.spaceName,
  }));

  // Show only the hours a room is actually bookable, with a little padding —
  // a full 24-hour grid squeezes the useful evening hours into a sliver.
  const { slotMinTime, slotMaxTime } = visibleTimeRange([
    ...businessHours,
    ...datedAvailability.map((a) => ({
      daysOfWeek: [],
      startTime: a.startTime,
      endTime: a.endTime,
    })),
  ]);

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-good/25 ring-1 ring-inset ring-good/40" />
          {legendSpaceCount === 1 ? "Room is free" : "A room is free"}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-ink-faint" />
          Practice already booked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-accent" />
          Suggested slot
        </span>
        <span className="ml-auto">
          Drag on an empty space to place a practice, or drag a practice to
          move it.
        </span>
      </div>
    <FullCalendar
      plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
      initialView="timeGridWeek"
      // Monday-first, matching the Monday-based weeks the rest of the app keys
      // off (conflict submissions, choreographer excuses, the week tracker).
      // With FullCalendar's default Sunday start, the visible week and the
      // week those features act on would be a day out of step.
      firstDay={1}
      headerToolbar={{ left: "prev,next today", center: "title", right: "timeGridWeek,dayGridMonth" }}
      height="auto"
      slotMinTime={slotMinTime}
      slotMaxTime={slotMaxTime}
      allDaySlot={false}
      nowIndicator
      selectable
      selectMirror
      editable
      businessHours={businessHours}
      events={[...availabilityEvents, ...practiceEvents, ...candidateEvents]}
      eventContent={renderEventContent}
      select={(info: DateSelectArg) => {
        onSelectRange(info.start.toISOString(), info.end.toISOString());
      }}
      eventDrop={(info: EventDropArg) => {
        if (!info.event.start || !info.event.end || info.event.id.startsWith("candidate-")) return;
        onEventMove(info.event.id, info.event.start.toISOString(), info.event.end.toISOString());
      }}
      eventResize={(info: EventResizeDoneArg) => {
        if (!info.event.start || !info.event.end) return;
        onEventMove(info.event.id, info.event.start.toISOString(), info.event.end.toISOString());
      }}
      datesSet={(arg) => onDatesSet(arg.start, arg.end)}
      />
    </>
  );
}

/** Narrows the visible grid to the space's opening hours (padded by an hour
 * each side), falling back to a sane evening-inclusive default. */
function visibleTimeRange(
  businessHours: { daysOfWeek: number[]; startTime: string; endTime: string }[],
) {
  if (businessHours.length === 0) {
    return { slotMinTime: "08:00:00", slotMaxTime: "23:00:00" };
  }
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const earliest = Math.min(...businessHours.map((b) => toMinutes(b.startTime)));
  const latest = Math.max(...businessHours.map((b) => toMinutes(b.endTime)));
  const pad = (mins: number) => {
    const clamped = Math.max(0, Math.min(24 * 60, mins));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  };
  return { slotMinTime: pad(earliest - 60), slotMaxTime: pad(latest + 60) };
}

function renderEventContent(arg: EventContentArg) {
  const status = arg.event.extendedProps.status as string | undefined;
  return (
    <div className="truncate px-1 text-xs">
      {arg.event.title}
      {status === "PROPOSED" && <span className="ml-1 italic">(draft)</span>}
    </div>
  );
}
