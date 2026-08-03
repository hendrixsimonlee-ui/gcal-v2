"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  overrideAttendance,
  setActualStartTime,
  submitAttendance,
  unsubmitAttendance,
} from "@/lib/actions/attendance";
import { addPracticeNote, deletePracticeNote } from "@/lib/actions/practice-notes";
import {
  removePlannedArrival,
  setPlannedArrival,
} from "@/lib/actions/planned-arrivals";
import { AttendanceBadge } from "@/components/status-badges";
import type { AttendanceStatus } from "@/lib/attendance";

export interface PanelRow {
  userId: string;
  name: string;
  role: "DANCER" | "CHOREOGRAPHER";
  status: AttendanceStatus | null;
  minutesLate: number | null;
  checkedInAt: string | null;
  isOverride: boolean;
  /** Set when they agreed in advance to arrive part-way through. */
  plannedArriveAt: string | null;
  /** Set when the AD reviewed a conflict covering this practice. */
  conflictStatus: "EXCUSED" | "UNEXCUSED" | null;
  conflictTitle: string | null;
}

export interface PanelNote {
  id: string;
  body: string;
  authorName: string;
  subjectUserId: string | null;
  subjectName: string | null;
  createdAt: string;
  canEdit: boolean;
}

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

/** Everything a choreographer needs for one practice: who's expected, who's
 * excused, who's coming late, who actually checked in — and the recap they
 * sign off at the end. */
export function PracticeAttendancePanel({
  practiceId,
  rows,
  notes,
  startDateTime,
  actualStartTime,
  submittedAt,
  canManage,
  viewerId,
  hasStarted,
}: {
  practiceId: string;
  rows: PanelRow[];
  notes: PanelNote[];
  startDateTime: string;
  actualStartTime: string | null;
  submittedAt: string | null;
  canManage: boolean;
  viewerId: string;
  /** False for a practice still in the future — there's nothing to sign off
   * or measure lateness against yet, so those controls stay hidden. */
  hasStarted: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSubject, setNoteSubject] = useState<string>("");
  const [arrivalUser, setArrivalUser] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work");
      }
    });
  }

  // The three groups the AD asked for, decided before anyone checks in.
  const excused = rows.filter(
    (r) => r.conflictStatus === "EXCUSED" && !r.plannedArriveAt,
  );
  const comingLate = rows.filter((r) => r.plannedArriveAt);
  const expected = rows.filter(
    (r) => !r.plannedArriveAt && r.conflictStatus !== "EXCUSED",
  );

  const checkedIn = rows.filter((r) => r.checkedInAt).length;
  const lateCount = rows.filter((r) => r.status === "LATE").length;
  const unexcused = rows.filter((r) => r.status === "UNEXCUSED_ABSENT").length;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          {hasStarted ? (
            <>
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {checkedIn} checked in
              </span>
              {lateCount > 0 && ` · ${lateCount} late`}
              {unexcused > 0 && ` · ${unexcused} unexcused`}
            </>
          ) : (
            <>
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                Hasn&rsquo;t happened yet
              </span>
              {" — "}
              {expected.length} expected, {comingLate.length} arriving late,{" "}
              {excused.length} excused. Everyone checks in once it starts.
            </>
          )}
        </p>
        {canManage &&
          hasStarted &&
          (submittedAt ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                Submitted
              </span>
              <button
                onClick={() => run(() => unsubmitAttendance(practiceId))}
                disabled={isPending}
                className="text-xs font-medium text-zinc-500 hover:underline"
              >
                Reopen to edit
              </button>
            </div>
          ) : (
            <button
              onClick={() => run(() => submitAttendance(practiceId))}
              disabled={isPending}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
            >
              {isPending ? "Submitting…" : "Submit attendance"}
            </button>
          ))}
      </div>

      {canManage && hasStarted && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <label className="text-zinc-600 dark:text-zinc-300">
            Did it start late?
          </label>
          <input
            type="time"
            defaultValue={
              actualStartTime ? toTimeInput(actualStartTime) : toTimeInput(startDateTime)
            }
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              if (Number.isNaN(h)) return;
              const when = new Date(startDateTime);
              when.setHours(h, m, 0, 0);
              run(() => setActualStartTime(practiceId, when.toISOString()));
            }}
            className="rounded-lg border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
          />
          <span className="text-xs text-zinc-500">
            Everyone&rsquo;s lateness is measured from this — saves
            automatically.
          </span>
          {actualStartTime && (
            <button
              onClick={() => run(() => setActualStartTime(practiceId, null))}
              disabled={isPending}
              className="text-xs font-medium text-zinc-500 hover:underline"
            >
              Started on time after all
            </button>
          )}
        </div>
      )}

      <Group
        title="Expected"
        rows={expected}
        practiceId={practiceId}
        canManage={canManage && hasStarted}
        showStatus={hasStarted}
        onRun={run}
      />
      <Group
        title="Coming late"
        rows={comingLate}
        practiceId={practiceId}
        canManage={canManage && hasStarted}
        showStatus={hasStarted}
        onRun={run}
        onClearArrival={
          canManage
            ? (userId) => run(() => removePlannedArrival(practiceId, userId))
            : undefined
        }
      />

      {canManage && !hasStarted && expected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-zinc-600 dark:text-zinc-300">
            Somebody arriving late?
          </span>
          <select
            value={arrivalUser}
            onChange={(e) => setArrivalUser(e.target.value)}
            className="rounded-lg border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="">Who…</option>
            {expected.map((r) => (
              <option key={r.userId} value={r.userId}>
                {r.name}
              </option>
            ))}
          </select>
          <input
            type="time"
            value={arrivalTime}
            onChange={(e) => setArrivalTime(e.target.value)}
            className="rounded-lg border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
          />
          <button
            onClick={() => {
              if (!arrivalUser || !arrivalTime) return;
              const [h, m] = arrivalTime.split(":").map(Number);
              const when = new Date(startDateTime);
              when.setHours(h, m, 0, 0);
              const who = arrivalUser;
              setArrivalUser("");
              setArrivalTime("");
              run(() => setPlannedArrival(practiceId, who, when.toISOString()));
            }}
            disabled={isPending || !arrivalUser || !arrivalTime}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            Save
          </button>
          <span className="text-xs text-zinc-500">
            Arriving by that time counts as on time.
          </span>
        </div>
      )}
      <Group
        title="Excused"
        rows={excused}
        practiceId={practiceId}
        canManage={canManage && hasStarted}
        showStatus={hasStarted}
        onRun={run}
      />

      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Notes
        </h2>
        <ul className="mb-3 flex flex-col gap-1.5">
          {notes.length === 0 && (
            <li className="text-sm text-zinc-500">Nothing written yet.</li>
          )}
          {notes.map((note) => (
            <li
              key={note.id}
              className="flex flex-wrap items-start gap-x-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60"
            >
              {note.subjectName && (
                <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                  {note.subjectName}
                </span>
              )}
              <span className="text-zinc-800 dark:text-zinc-200">{note.body}</span>
              <span className="text-xs text-zinc-400">— {note.authorName}</span>
              {note.canEdit && (
                <button
                  onClick={() => run(() => deletePracticeNote(note.id))}
                  className="ml-auto text-xs font-medium text-red-600 hover:underline"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={noteSubject}
            onChange={(e) => setNoteSubject(e.target.value)}
            className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="">About the practice</option>
            {/* Only a choreographer or admin may write about someone else,
                so don't offer names a dancer would be refused on. */}
            {(canManage ? rows : rows.filter((r) => r.userId === viewerId)).map(
              (r) => (
                <option key={r.userId} value={r.userId}>
                  About {r.userId === viewerId ? "me" : r.name}
                </option>
              ),
            )}
          </select>
          <input
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder={
              canManage
                ? "Ran 20 minutes short, or: Leila is walking over from class"
                : "I was walking over from a class that ran long"
            }
            className="min-w-56 flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
          <button
            onClick={() => {
              if (!noteDraft.trim()) return;
              const body = noteDraft;
              const subject = noteSubject || null;
              setNoteDraft("");
              run(() => addPracticeNote(practiceId, subject, body));
            }}
            disabled={isPending}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            Add note
          </button>
        </div>
      </section>
    </div>
  );
}

function Group({
  title,
  rows,
  practiceId,
  canManage,
  showStatus,
  onRun,
  onClearArrival,
}: {
  title: string;
  rows: PanelRow[];
  practiceId: string;
  canManage: boolean;
  showStatus: boolean;
  onRun: (fn: () => Promise<unknown>) => void;
  onClearArrival?: (userId: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {title}{" "}
        <span className="font-normal text-zinc-400">({rows.length})</span>
      </h2>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li
            key={row.userId}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60"
          >
            <span className="font-medium text-zinc-900 dark:text-zinc-50">
              {row.name}
            </span>
            {row.role === "CHOREOGRAPHER" && (
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                Choreographer
              </span>
            )}
            {row.plannedArriveAt && (
              <span className="text-xs text-zinc-500">
                due {timeFormatter.format(new Date(row.plannedArriveAt))}
              </span>
            )}
            {row.conflictTitle && !row.checkedInAt && (
              <span className="text-xs text-zinc-500">{row.conflictTitle}</span>
            )}
            {row.checkedInAt && (
              <span className="text-xs text-zinc-500">
                in at {timeFormatter.format(new Date(row.checkedInAt))}
              </span>
            )}

            <span className="ml-auto flex items-center gap-2">
              {showStatus && (
                <AttendanceBadge
                  status={row.status}
                  minutesLate={row.minutesLate}
                />
              )}
              {row.isOverride && (
                <span className="text-[10px] uppercase text-zinc-400">edited</span>
              )}
              {onClearArrival && (
                <button
                  onClick={() => onClearArrival(row.userId)}
                  className="text-xs font-medium text-zinc-500 hover:underline"
                >
                  Remove
                </button>
              )}
              {canManage && (
                <select
                  value={row.status ?? ""}
                  onChange={(e) =>
                    onRun(() =>
                      overrideAttendance(
                        practiceId,
                        row.userId,
                        e.target.value as AttendanceStatus,
                      ),
                    )
                  }
                  className="rounded-lg border border-zinc-300 px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                >
                  <option value="" disabled>
                    Change…
                  </option>
                  <option value="PRESENT">Here</option>
                  <option value="LATE">Late</option>
                  <option value="EXCUSED_ABSENT">Excused</option>
                  <option value="UNEXCUSED_ABSENT">Unexcused</option>
                </select>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
