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
}

const DANCE_COLORS = [
  "#a855f7",
  "#0ea5e9",
  "#f97316",
  "#22c55e",
  "#ec4899",
  "#eab308",
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
  onSelectRange,
  onEventMove,
  onDatesSet,
}: {
  practices: PracticeEvent[];
  candidates: CandidateSlot[];
  businessHours: { daysOfWeek: number[]; startTime: string; endTime: string }[];
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

  const candidateEvents: EventInput[] = candidates.map((c, i) => ({
    id: `candidate-${i}`,
    title: `#${i + 1} candidate (score ${c.score})`,
    start: c.startDateTime.toISOString(),
    end: c.endDateTime.toISOString(),
    display: "block",
    backgroundColor: "transparent",
    borderColor: "#18181b",
    textColor: "#18181b",
    classNames: ["border-2", "border-dotted", "candidate-slot"],
    editable: false,
  }));

  return (
    <FullCalendar
      plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
      initialView="timeGridWeek"
      headerToolbar={{ left: "prev,next today", center: "title", right: "timeGridWeek,dayGridMonth" }}
      height="auto"
      selectable
      selectMirror
      editable
      businessHours={businessHours}
      events={[...practiceEvents, ...candidateEvents]}
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
  );
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
