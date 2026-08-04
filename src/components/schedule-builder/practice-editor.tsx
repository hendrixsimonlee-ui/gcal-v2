"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  confirmPractice,
  deletePractice,
  getPracticeDetail,
  unpublishPractice,
  updatePracticeSpace,
  updatePracticeTime,
  type PracticeDetail,
} from "@/lib/actions/schedule";
import { LateArrivals } from "@/components/schedule-builder/late-arrivals";
import { appDateKey, appTimeKey, parseAppDateTime } from "@/lib/timezone";

/** One practice, everything about it, in one panel.
 *
 * The three edits the AD actually makes late in the week — move the time,
 * change the room, decide who's arriving late — used to live in three
 * different places, and changing a room meant deleting the practice and
 * rebuilding it. They're together here, reachable by clicking a practice
 * anywhere on the builder.
 *
 * Nothing in here notifies anyone. Edits to a published practice are staged
 * and go out when the AD presses Publish changes, which is what makes it safe
 * to fiddle. */
export function PracticeEditor({
  practiceId,
  onClose,
  onChanged,
}: {
  practiceId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<PracticeDetail | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function reload() {
    setDetail(await getPracticeDetail(practiceId));
  }

  useEffect(() => {
    let cancelled = false;
    getPracticeDetail(practiceId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load it"));
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  function run(fn: () => Promise<string | null>) {
    setError(null);
    startTransition(async () => {
      try {
        const message = await fn();
        await reload();
        setNote(message);
        onChanged();
        router.refresh();
      } catch (e) {
        setNote(null);
        setError(e instanceof Error ? e.message : "That didn't work.");
      }
    });
  }

  if (!detail) {
    return (
      <section className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-soft">
        {error ?? "Loading the practice…"}
      </section>
    );
  }

  const start = new Date(detail.startIso);
  const end = new Date(detail.endIso);

  function saveTimes(formData: FormData) {
    const dateKey = String(formData.get("date") ?? "");
    const startKey = String(formData.get("start") ?? "");
    const endKey = String(formData.get("end") ?? "");
    if (!dateKey || !startKey || !endKey) return;
    if (startKey >= endKey) {
      setError("The finish time has to be after the start time.");
      return;
    }
    run(async () => {
      await updatePracticeTime(
        practiceId,
        parseAppDateTime(dateKey, startKey).toISOString(),
        parseAppDateTime(dateKey, endKey).toISOString(),
      );
      return detail!.status === "CONFIRMED"
        ? "Time changed. The cast hasn't been told yet — use Publish changes when you're done."
        : "Time changed.";
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-accent/40 bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {detail.danceName}
          </h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            {detail.status === "CONFIRMED" ? "Published" : "Draft"} ·{" "}
            {detail.castSize} in the cast
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-xs font-medium text-ink-soft hover:underline"
        >
          Close
        </button>
      </div>

      {detail.pendingAnnouncement && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
          Changed since it was published
          {detail.pendingChangeNote ? ` — ${detail.pendingChangeNote}` : ""}.
          Nobody has been told. Publish changes from the week tracker to send
          it.
        </p>
      )}

      {/* Time */}
      <form action={saveTimes} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Date</span>
          <input
            type="date"
            name="date"
            defaultValue={appDateKey(start)}
            min="2026-01-01"
            className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Starts</span>
          <input
            type="time"
            name="start"
            defaultValue={appTimeKey(start)}
            className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Finishes</span>
          <input
            type="time"
            name="end"
            defaultValue={appTimeKey(end)}
            className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-surface-2 disabled:opacity-45"
        >
          Save time
        </button>
      </form>

      {/* Room */}
      <label className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink-soft">Room</span>
        <select
          value={detail.spaceId ?? ""}
          disabled={isPending}
          onChange={(e) =>
            run(async () => {
              await updatePracticeSpace(practiceId, e.target.value || null);
              return "Room changed.";
            })
          }
          className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm disabled:opacity-45"
        >
          <option value="">No room yet</option>
          {detail.availableSpaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-soft">
          Only rooms free at this time are listed.
        </span>
      </label>

      {/* Who's arriving late */}
      <div>
        <p className="text-xs font-medium text-ink-soft">Arriving late</p>
        <LateArrivals
          practiceId={practiceId}
          existing={detail.plannedArrivals.map((a) => ({
            userId: a.userId,
            name: a.name,
            arriveAt: a.arriveAtIso,
          }))}
        />
        {detail.plannedArrivals.length === 0 && (
          <p className="mt-1 text-xs text-ink-soft">
            Nobody yet. Anyone with a class running into this practice shows up
            here as a suggestion.
          </p>
        )}
      </div>

      {/* Status + attendance */}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        {detail.status === "PROPOSED" ? (
          <button
            onClick={() =>
              run(async () => {
                await confirmPractice(practiceId);
                return "Published. The cast has been told.";
              })
            }
            disabled={isPending}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
          >
            Publish this practice
          </button>
        ) : (
          <button
            onClick={() =>
              run(async () => {
                await unpublishPractice(practiceId);
                return "Back to draft. The cast has been told it's off.";
              })
            }
            disabled={isPending}
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-surface-2 disabled:opacity-45"
          >
            Take it back to draft
          </button>
        )}

        {detail.hasEnded && (
          <Link
            href={`/attendance/${practiceId}`}
            className="text-sm font-medium text-accent hover:underline"
          >
            {detail.attendanceSubmitted
              ? "Attendance (submitted)"
              : "Take attendance"}
          </Link>
        )}

        <button
          onClick={() => {
            if (
              !confirm(
                detail.status === "CONFIRMED"
                  ? `Cancel this ${detail.danceName} practice? The cast will be told.`
                  : "Discard this draft?",
              )
            )
              return;
            run(async () => {
              await deletePractice(practiceId);
              onClose();
              return null;
            });
          }}
          disabled={isPending}
          className="ml-auto text-sm font-medium text-ink-faint transition-colors hover:text-bad disabled:opacity-45"
        >
          {detail.status === "CONFIRMED" ? "Cancel practice" : "Discard draft"}
        </button>
      </div>

      {note && <p className="text-sm text-good">{note}</p>}
      {error && <p className="text-sm font-medium text-bad">{error}</p>}
    </section>
  );
}
