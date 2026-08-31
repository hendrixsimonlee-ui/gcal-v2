"use client";

import FullCalendar from "@fullcalendar/react";
import { useEffect, useRef } from "react";
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
 * No green, no gold and no orange in here, deliberately. Green already means
 * "this room is free" on this very grid, gold means "this is a control", and
 * orange means "careful" — a dance block in any of them would be read as
 * something it isn't. What's left is the cool half of the wheel, which also
 * happens to sit well against the warm ground. */
const DANCE_COLORS = [
  "#2563eb", // blue
  "#be185d", // plum
  "#0891b2", // cyan
  "#6d28d9", // violet
  "#0f766e", // deep teal
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
  datedAvailability,
  legendSpaceCount,
  onSelectRange,
  onEventMove,
  onEventClick,
  onDatesSet,
  gotoDateKey,
}: {
  practices: PracticeEvent[];
  candidates: CandidateSlot[];
  /** Every block a room is ours. Rooms come only from the spaces calendar
   * now, so there is no weekly pattern left for FullCalendar's
   * `businessHours` to express — these bands are the whole picture. */
  datedAvailability: {
    spaceName: string;
    dateKey: string;
    startTime: string;
    endTime: string;
  }[];
  /** "YYYY-MM-DD" to jump to. The grid owns which week is showing, so a date
   * picker outside it has to ask rather than set state — changing this sends
   * the calendar to that date's week. */
  gotoDateKey?: string;
  /** Only used to word the legend, so "space is free" reads correctly whether
   * one room or all of them are in view. */
  legendSpaceCount: number;
  onSelectRange: (startIso: string, endIso: string) => void;
  onEventMove: (practiceId: string, startIso: string, endIso: string) => void;
  /** Clicking a practice opens it for editing rather than doing nothing,
   * which is what a block on a calendar is expected to do. */
  onEventClick: (practiceId: string) => void;
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
      // A draft is hatched and dash-bordered; a published practice is a solid
      // block. Fading it instead (what this did before) reads as "less
      // important" rather than "not final", and made the text harder to read
      // into the bargain — the one state you most need to notice was the one
      // that stood out least.
      classNames: p.status === "PROPOSED" ? ["padt-draft"] : ["padt-published"],
      extendedProps: {
        status: p.status,
        spaceName: p.spaceName,
        danceName: p.danceName,
      },
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
  //
  // The fill is deliberately strong. At 14% opacity these bands were all but
  // invisible against the grid lines, and "where do we actually have a room?"
  // is the single question this screen exists to answer — it should be the
  // loudest thing on it, not the quietest.
  const availabilityEvents: EventInput[] = datedAvailability.map((a) => ({
    start: `${a.dateKey}T${a.startTime}:00`,
    end: `${a.dateKey}T${a.endTime}:00`,
    display: "background",
    backgroundColor: "rgba(16, 185, 129, 0.34)",
    title: a.spaceName,
  }));

  // The grid runs the whole useful day and scrolls, rather than being clipped
  // to whatever hours happen to be booked. Clipping meant an empty week had
  // almost no grid to drag on at all, and any slot outside the current
  // bookings was simply unreachable. `scrollTime` opens it at the first hour
  // anything is happening, so the scroll costs nothing in the common case.
  const { slotMinTime, slotMaxTime, scrollTime } =
    visibleTimeRange(datedAvailability);

  const calendarRef = useRef<FullCalendar | null>(null);

  // Jump the grid when something outside it asks. FullCalendar owns the
  // visible range, so this is the only way for a date picker sitting above
  // the calendar to move it.
  useEffect(() => {
    if (!gotoDateKey) return;
    calendarRef.current?.getApi().gotoDate(gotoDateKey);
  }, [gotoDateKey]);

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
        <span className="flex items-center gap-1.5">
          <span className="padt-draft inline-block h-2.5 w-2.5 rounded-sm border-2 border-dashed border-ink-faint bg-ink-faint" />
          Draft — nobody told yet
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-ink-faint" />
          Published
        </span>
        <span className="ml-auto">
          Drag on shaded time to place a practice, drag a practice to move it,
          or click one to change its room, time or cast.
        </span>
      </div>
    <FullCalendar
      ref={calendarRef}
      plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
      initialView="timeGridWeek"
      // Monday-first, matching the Monday-based weeks the rest of the app keys
      // off (conflict submissions, choreographer excuses, the week tracker).
      // With FullCalendar's default Sunday start, the visible week and the
      // week those features act on would be a day out of step.
      firstDay={1}
      headerToolbar={{ left: "prev,next today", center: "title", right: "timeGridWeek,dayGridMonth" }}
      slotMinTime={slotMinTime}
      slotMaxTime={slotMaxTime}
      scrollTime={scrollTime}
      // Fills the viewport and scrolls inside itself, instead of growing the
      // page. The grid is the screen's whole job; it should get the screen.
      height="calc(100vh - 15rem)"
      expandRows
      slotDuration="00:30:00"
      snapDuration="00:15:00"
      allDaySlot={false}
      nowIndicator
      selectable
      selectMirror
      editable
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
      eventClick={(info) => {
        if (info.event.id.startsWith("candidate-")) return;
        if (!info.event.id) return;
        onEventClick(info.event.id);
      }}
      datesSet={(arg) => onDatesSet(arg.start, arg.end)}
      />
    </>
  );
}

/** Narrows the visible grid to the space's opening hours (padded by an hour
 * each side), falling back to a sane evening-inclusive default. */
/** A generous fixed window, plus where to open the scroll.
 *
 * This used to narrow the grid to exactly the booked hours. That read well
 * when a week was full and badly the rest of the time: an unsynced week had
 * a three-hour grid, and nothing outside the current bookings could be
 * dragged at all. Now the day is always 6am to midnight and scrolls, and
 * only the starting scroll position follows the data. */
function visibleTimeRange(
  windows: { startTime: string; endTime: string }[],
) {
  const slotMinTime = "06:00:00";
  const slotMaxTime = "24:00:00";
  if (windows.length === 0) {
    return { slotMinTime, slotMaxTime, scrollTime: "08:00:00" };
  }
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const earliest = Math.min(...windows.map((w) => toMinutes(w.startTime)));
  const opening = Math.max(0, earliest - 60);
  const h = Math.floor(opening / 60);
  const m = opening % 60;
  return {
    slotMinTime,
    slotMaxTime,
    scrollTime: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`,
  };
}

const blockTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

/** Name, both times, room. The block used to show only the name and the room,
 * so answering "when does this finish?" meant measuring it against the axis
 * by eye. */
function renderEventContent(arg: EventContentArg) {
  const status = arg.event.extendedProps.status as string | undefined;
  if (arg.event.display === "background") {
    return <div className="px-1 pt-0.5 text-[10px] font-medium opacity-70">{arg.event.title}</div>;
  }

  const { start, end } = arg.event;
  const range =
    start && end
      ? `${blockTimeFormatter.format(start)}–${blockTimeFormatter.format(end)}`
      : "";

  return (
    <div className="overflow-hidden px-1 text-xs leading-tight">
      {/* The badge leads, so a narrow block truncates the dance name rather
          than the one word that says this isn't real yet. */}
      <div className="truncate font-semibold">
        {status === "PROPOSED" && (
          <span className="mr-1 rounded-sm bg-white/90 px-1 text-[9px] font-bold uppercase tracking-wide text-black/80">
            Draft
          </span>
        )}
        {String(arg.event.extendedProps.danceName ?? arg.event.title)}
      </div>
      <div className="truncate tabular-nums opacity-90">{range}</div>
      {arg.event.extendedProps.spaceName ? (
        <div className="truncate opacity-80">
          {String(arg.event.extendedProps.spaceName)}
        </div>
      ) : null}
    </div>
  );
}
