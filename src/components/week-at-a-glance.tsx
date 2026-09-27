"use client";

import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { EventContentArg, EventInput } from "@fullcalendar/core";
import { toGridTime, zonedParts } from "@/lib/timezone";

export interface WeekPractice {
  id: string;
  danceId: string;
  danceName: string;
  spaceName: string | null;
  startDateTime: string;
  endDateTime: string;
  status: "PROPOSED" | "CONFIRMED";
}

/** The same palette the Schedule Builder uses, so a dance is the same colour
 * on both screens. Copied rather than imported because that module is the
 * editable grid, and this one is not meant to drag it along. */
const DANCE_COLORS = [
  "#2563eb",
  "#7e22ce",
  "#0891b2",
  "#4338ca",
  "#0f766e",
  "#475569",
];

function colorForDance(danceId: string): string {
  let hash = 0;
  for (let i = 0; i < danceId.length; i++) {
    hash = (hash * 31 + danceId.charCodeAt(i)) >>> 0;
  }
  return DANCE_COLORS[hash % DANCE_COLORS.length];
}

/** This week, as a calendar, and nothing else.
 *
 * Deliberately not the Schedule Builder's grid. That one exists to be dragged
 * on — it carries room availability bands, ranked slot suggestions, drag to
 * create, drag to move — and on a home page every one of those is a way to
 * change the schedule by accident while reading it. This shows the week and
 * clicking a practice opens it. */
export function WeekAtAGlance({ practices }: { practices: WeekPractice[] }) {
  const router = useRouter();

  // Eastern wall-clock, handed over with no zone on it.
  //
  // FullCalendar lays events out in the *browser's* timezone. Given a real
  // instant, a 2pm Philadelphia rehearsal draws at 6pm for a viewer whose
  // machine is on UTC — and when the grid is trimmed to the hours the week
  // actually uses, it draws outside the window and disappears altogether,
  // which is how this was found. Stripping the zone and saying "2pm" makes
  // the grid read as Eastern for everybody, which is what every other date on
  // this app already does.
  const events: EventInput[] = practices.map((p) => {
    const color = colorForDance(p.danceId);
    return {
      id: p.id,
      title: p.danceName,
      start: toGridTime(new Date(p.startDateTime)),
      end: toGridTime(new Date(p.endDateTime)),
      backgroundColor: color,
      borderColor: color,
      classNames: p.status === "PROPOSED" ? ["padt-draft"] : ["padt-published"],
      extendedProps: { spaceName: p.spaceName, isDraft: p.status === "PROPOSED" },
    };
  });

  // Show the hours the week actually uses, padded by one. A fixed 6am-to-
  // midnight grid spends half its height on an empty morning, and the whole
  // point of this being a calendar rather than a list is that the shape of
  // the week is readable at a glance.
  //
  // Eastern, not the browser's clock: `getHours()` here would put the grid an
  // hour or five out for anybody whose laptop isn't set to New York, which is
  // the same bug that moved the "did it start late" control.
  const hours = practices.flatMap((p) => [
    zonedParts(new Date(p.startDateTime)).hour,
    // An 8pm finish lands on hour 20; the row it needs is the one after.
    zonedParts(new Date(p.endDateTime)).hour + 1,
  ]);
  const first = hours.length ? Math.max(0, Math.min(...hours) - 1) : 9;
  const last = hours.length ? Math.min(24, Math.max(...hours) + 1) : 23;
  const pad2 = (n: number) => String(n).padStart(2, "0");

  return (
    <FullCalendar
      plugins={[timeGridPlugin]}
      initialView="timeGridWeek"
      // Monday-first, like every other week the app keys off.
      firstDay={1}
      headerToolbar={{ left: "prev,next today", center: "title", right: "" }}
      slotMinTime={`${pad2(first)}:00:00`}
      slotMaxTime={`${pad2(last)}:00:00`}
      height="34rem"
      expandRows
      slotDuration="01:00:00"
      allDaySlot={false}
      nowIndicator
      events={events}
      eventContent={renderEvent}
      eventClick={(info) => {
        if (info.event.id) router.push(`/attendance/${info.event.id}`);
      }}
    />
  );
}

function renderEvent(arg: EventContentArg) {
  const space = arg.event.extendedProps.spaceName as string | null;
  const isDraft = arg.event.extendedProps.isDraft as boolean;
  return (
    <div className="overflow-hidden px-1 py-0.5 text-[11px] leading-tight">
      <div className="font-semibold">
        {isDraft && <span className="mr-1 opacity-80">Draft</span>}
        {arg.event.title}
      </div>
      <div className="opacity-90">{arg.timeText}</div>
      {space && <div className="truncate opacity-80">{space}</div>}
    </div>
  );
}
