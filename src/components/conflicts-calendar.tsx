"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type {
  DateSelectArg,
  EventClickArg,
  EventDropArg,
  EventInput,
} from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import {
  addConflict,
  deleteConflict,
  updateConflictTime,
} from "@/lib/actions/conflicts";

export interface CalendarConflict {
  id: string;
  startDateTime: string;
  endDateTime: string;
  title: string | null;
  status: "NOT_REVIEWED" | "EXCUSED" | "UNEXCUSED";
  isRecurring: boolean;
  fromGoogle: boolean;
}

/** Local datetime string for <input type="datetime-local">, which rejects
 * the trailing-Z form that toISOString() produces. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultRange(): { start: string; end: string } {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return { start: toLocalInput(start), end: toLocalInput(end) };
}

export function ConflictsCalendar({
  conflicts,
}: {
  conflicts: CalendarConflict[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<{
    start: string;
    end: string;
    title: string;
    isRecurring: boolean;
  } | null>(null);

  function openDraft(start?: Date, end?: Date) {
    const fallback = defaultRange();
    setError(null);
    setDraft({
      start: start ? toLocalInput(start) : fallback.start,
      end: end ? toLocalInput(end) : fallback.end,
      title: "",
      isRecurring: false,
    });
  }

  function submitDraft() {
    if (!draft) return;
    setError(null);
    startTransition(async () => {
      try {
        await addConflict({
          startDateTime: draft.start,
          endDateTime: draft.end,
          title: draft.title,
          isRecurring: draft.isRecurring,
        });
        setDraft(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't add that conflict");
      }
    });
  }

  function move(id: string, start: Date, end: Date, revert: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        await updateConflictTime(id, start.toISOString(), end.toISOString());
        router.refresh();
      } catch (e) {
        revert();
        setError(e instanceof Error ? e.message : "Couldn't move that conflict");
      }
    });
  }

  const events: EventInput[] = conflicts.map((c) => {
    // Grey until the AD has looked at it, then blue for excused and amber
    // for not. The dancer sees the AD's answer without being asked for one.
    const color =
      c.status === "EXCUSED"
        ? "#0ea5e9"
        : c.status === "UNEXCUSED"
          ? "#f59e0b"
          : "#a1a1aa";
    return {
      id: c.id,
      title: c.title || "Conflict",
      start: c.startDateTime,
      end: c.endDateTime,
      backgroundColor: color,
      borderColor: color,
    };
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-soft">
          Drag across any empty time to add a conflict. Drag an existing one to
          move it, or click it to delete.
        </p>
        <button
          onClick={() => openDraft()}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
        >
          + Add conflict
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      {draft && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line-strong bg-surface-2 p-3 bg-surface-3">
          <Field label="Start">
            <input
              type="datetime-local"
              value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
              className="rounded-lg border border-line-strong px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="End">
            <input
              type="datetime-local"
              value={draft.end}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
              className="rounded-lg border border-line-strong px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="What is it?" grow>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Orgo lab, work shift, family thing…"
              className="w-full rounded-lg border border-line-strong px-2 py-1.5 text-sm"
            />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={draft.isRecurring}
              onChange={(e) =>
                setDraft({ ...draft, isRecurring: e.target.checked })
              }
            />
            Repeats weekly
          </label>
          <button
            onClick={submitDraft}
            disabled={isPending}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {isPending ? "Adding…" : "Add"}
          </button>
          <button
            onClick={() => setDraft(null)}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:bg-surface-3"
          >
            Cancel
          </button>
        </div>
      )}

      <FullCalendar
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
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
        allDaySlot={false}
        nowIndicator
        selectable
        selectMirror
        editable
        events={events}
        select={(info: DateSelectArg) => openDraft(info.start, info.end)}
        eventClick={(info: EventClickArg) => {
          if (!confirm("Delete this conflict?")) return;
          startTransition(async () => {
            await deleteConflict(info.event.id);
            router.refresh();
          });
        }}
        eventDrop={(info: EventDropArg) => {
          if (!info.event.start || !info.event.end) return;
          move(info.event.id, info.event.start, info.event.end, info.revert);
        }}
        eventResize={(info: EventResizeDoneArg) => {
          if (!info.event.start || !info.event.end) return;
          move(info.event.id, info.event.start, info.event.end, info.revert);
        }}
      />
    </div>
  );
}

function Field({
  label,
  children,
  grow,
}: {
  label: string;
  children: React.ReactNode;
  grow?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1 ${grow ? "min-w-[12rem] flex-1" : ""}`}>
      <label className="text-xs font-medium text-ink-soft">{label}</label>
      {children}
    </div>
  );
}
