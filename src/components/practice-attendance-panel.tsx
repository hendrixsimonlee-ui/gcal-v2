"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  markAttendance,
  setActualStartTime,
  submitAttendance,
  unsubmitAttendance,
} from "@/lib/actions/attendance";
import { raiseAttendanceFlag } from "@/lib/actions/attendance-flags";
import { setMinutesLate } from "@/lib/actions/dues";
import { addPracticeNote, deletePracticeNote } from "@/lib/actions/practice-notes";
import {
  removePlannedArrival,
  setPlannedArrival,
} from "@/lib/actions/planned-arrivals";
import { AttendanceBadge } from "@/components/status-badges";
import {
  OUTCOME_LABELS,
  outcomeForStatus,
  type AttendanceOutcome,
  type AttendanceStatus,
} from "@/lib/attendance";
import { APP_TIME_ZONE, appTimeKey, zonedParts, zonedTimeToInstant } from "@/lib/timezone";

export interface PanelRow {
  userId: string;
  name: string;
  role: "DANCER" | "CHOREOGRAPHER";
  status: AttendanceStatus | null;
  minutesLate: number | null;
  checkedInAt: string | null;
  isOverride: boolean;
  /** Null until a record exists. Correcting the minutes is keyed on it. */
  attendanceId: string | null;
  /** What the check-in measured, shown beside the charged figure when they
   * differ so a correction is visible rather than silent. */
  measuredMinutesLate: number | null;
  cameDespiteExcusal: boolean;
  /** Set when they agreed in advance to arrive part-way through. */
  plannedArriveAt: string | null;
  /** Whatever conflict they logged over this practice, reviewed or not. */
  conflictStatus: "EXCUSED" | "UNEXCUSED" | "NOT_REVIEWED" | null;
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
  timeZone: APP_TIME_ZONE,
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
  isAdmin,
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
  /** The AD. They can change anything; a choreographer can only say that
   * somebody who never checked in was in fact there, and only before they
   * submit. Everything else they raise as a flag. */
  isAdmin: boolean;
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

  // Four groups, decided before anybody checks in, so the choreographer walks
  // in knowing their real number.
  //
  // People who logged a conflict nobody excused used to sit in Expected, which
  // meant chasing somebody the AD already knew wasn't coming. They get their
  // own group now — still not excused, still counted against them, but not the
  // choreographer's problem tonight.
  const comingLate = rows.filter((r) => r.plannedArriveAt);
  const rest = rows.filter((r) => !r.plannedArriveAt);
  const excused = rest.filter((r) => r.conflictStatus === "EXCUSED");
  const notComing = rest.filter(
    (r) => r.conflictStatus === "UNEXCUSED" || r.conflictStatus === "NOT_REVIEWED",
  );
  const expected = rest.filter((r) => r.conflictStatus === null);

  const checkedIn = rows.filter((r) => r.checkedInAt).length;
  const lateCount = rows.filter((r) => r.status === "LATE").length;
  const unexcused = rows.filter((r) => r.status === "UNEXCUSED_ABSENT").length;
  // What the choreographer is actually waiting for: everyone who is supposed
  // to walk through the door, which is not the same as the cast size.
  const dueInTheRoom = expected.length + comingLate.length;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <p className="text-sm text-ink-soft">
          {hasStarted ? (
            <>
              <span className="font-medium text-ink">
                {checkedIn} of {dueInTheRoom} in
              </span>
              {lateCount > 0 && ` · ${lateCount} late`}
              {unexcused > 0 && ` · ${unexcused} unexcused`}
              {excused.length > 0 && ` · ${excused.length} excused`}
            </>
          ) : (
            <>
              <span className="font-medium text-ink">
                {dueInTheRoom} due in the room
              </span>
              {" — "}
              {expected.length} expected
              {comingLate.length > 0 && `, ${comingLate.length} arriving late`}
              {excused.length > 0 && `, ${excused.length} excused`}
              {notComing.length > 0 && `, ${notComing.length} not coming`}.
            </>
          )}
        </p>
        {canManage &&
          hasStarted &&
          (submittedAt ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium text-good">
                Submitted
              </span>
              <button
                onClick={() => run(() => unsubmitAttendance(practiceId))}
                disabled={isPending}
                className="text-xs font-medium text-ink-soft hover:underline"
              >
                Reopen to edit
              </button>
            </div>
          ) : (
            <button
              onClick={() => run(() => submitAttendance(practiceId))}
              disabled={isPending}
              className="rounded-lg bg-good px-4 py-2 text-sm font-medium text-surface transition-colors hover:opacity-90 disabled:opacity-45"
            >
              {isPending ? "Submitting…" : "Submit attendance"}
            </button>
          ))}
      </div>

      {canManage && hasStarted && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <label className="text-ink-soft">
            Did it start late?
          </label>
          <input
            type="time"
            defaultValue={appTimeKey(
              new Date(actualStartTime ?? startDateTime),
            )}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              if (Number.isNaN(h)) return;
              // Eastern, not the browser's clock. `setHours` used whatever
              // zone the viewer happens to be in, so an AD travelling — or
              // any machine not set to Eastern — moved the real start of the
              // rehearsal by the offset, and everybody's lateness with it.
              const day = zonedParts(new Date(startDateTime));
              const when = zonedTimeToInstant(day.year, day.month, day.day, h, m);
              run(() => setActualStartTime(practiceId, when.toISOString()));
            }}
            className="rounded-lg border border-line-strong px-2 py-1 bg-surface-3"
          />
          <span className="text-xs text-ink-soft">
            Everyone&rsquo;s lateness is measured from this — saves
            automatically.
          </span>
          {actualStartTime && (
            <button
              onClick={() => run(() => setActualStartTime(practiceId, null))}
              disabled={isPending}
              className="text-xs font-medium text-ink-soft hover:underline"
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
        isAdmin={isAdmin}
        submitted={submittedAt !== null}
        showStatus={hasStarted}
        viewerId={viewerId}
        onRun={run}
      />
      <Group
        title="Coming late"
        subtitle="Agreed a time in advance. Arriving by it is on time."
        rows={comingLate}
        practiceId={practiceId}
        canManage={canManage && hasStarted}
        isAdmin={isAdmin}
        submitted={submittedAt !== null}
        showStatus={hasStarted}
        viewerId={viewerId}
        onRun={run}
        onClearArrival={
          canManage
            ? (userId) => run(() => removePlannedArrival(practiceId, userId))
            : undefined
        }
      />

      {canManage && !hasStarted && expected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <span className="text-ink-soft">
            Somebody arriving late?
          </span>
          <select
            value={arrivalUser}
            onChange={(e) => setArrivalUser(e.target.value)}
            className="rounded-lg border border-line-strong px-2 py-1.5 bg-surface-3"
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
            className="rounded-lg border border-line-strong px-2 py-1 bg-surface-3"
          />
          <button
            onClick={() => {
              if (!arrivalUser || !arrivalTime) return;
              const [h, m] = arrivalTime.split(":").map(Number);
              // Eastern, like the start time above. An agreed arrival is the
              // other baseline lateness gets measured from, so a browser in
              // the wrong zone would quietly charge somebody for arriving
              // exactly when they said they would.
              const day = zonedParts(new Date(startDateTime));
              const when = zonedTimeToInstant(day.year, day.month, day.day, h, m);
              const who = arrivalUser;
              setArrivalUser("");
              setArrivalTime("");
              run(() => setPlannedArrival(practiceId, who, when.toISOString()));
            }}
            disabled={isPending || !arrivalUser || !arrivalTime}
            className="rounded-lg bg-accent px-3 py-1.5 font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-45"
          >
            Save
          </button>
          <span className="text-xs text-ink-soft">
            Arriving by that time counts as on time.
          </span>
        </div>
      )}
      <Group
        title="Excused"
        subtitle="Told the AD and been let off. Nothing for you to do."
        rows={excused}
        practiceId={practiceId}
        canManage={canManage && hasStarted}
        isAdmin={isAdmin}
        submitted={submittedAt !== null}
        showStatus={hasStarted}
        viewerId={viewerId}
        onRun={run}
      />
      <Group
        title="Not coming"
        subtitle="Logged a conflict the AD hasn't let them off. It still counts against them — you don't have to chase them."
        rows={notComing}
        practiceId={practiceId}
        canManage={canManage && hasStarted}
        isAdmin={isAdmin}
        submitted={submittedAt !== null}
        showStatus={hasStarted}
        viewerId={viewerId}
        onRun={run}
      />

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">
          Notes
        </h2>
        <ul className="mb-3 flex flex-col gap-1.5">
          {notes.length === 0 && (
            <li className="text-sm text-ink-soft">Nothing written yet.</li>
          )}
          {notes.map((note) => (
            <li
              key={note.id}
              className="flex flex-wrap items-start gap-x-2 rounded-lg bg-surface-2 px-3 py-2 text-sm bg-surface/60"
            >
              {note.subjectName && (
                <span className="rounded bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                  {note.subjectName}
                </span>
              )}
              <span className="text-ink">{note.body}</span>
              <span className="text-xs text-ink-faint">— {note.authorName}</span>
              {note.canEdit && (
                <button
                  onClick={() => run(() => deletePracticeNote(note.id))}
                  className="ml-auto text-xs font-medium text-ink-faint transition-colors hover:text-bad"
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
            className="rounded-lg border border-line-strong px-2 py-1.5 text-sm bg-surface"
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
            className="min-w-56 flex-1 rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
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
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-45"
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
  subtitle,
  rows,
  practiceId,
  canManage,
  isAdmin,
  submitted,
  showStatus,
  viewerId,
  onRun,
  onClearArrival,
}: {
  title: string;
  subtitle?: string;
  rows: PanelRow[];
  practiceId: string;
  canManage: boolean;
  isAdmin: boolean;
  submitted: boolean;
  showStatus: boolean;
  viewerId: string;
  onRun: (fn: () => Promise<unknown>) => void;
  onClearArrival?: (userId: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">
        {title}{" "}
        <span className="font-normal text-ink-faint">({rows.length})</span>
      </h2>
      {subtitle && (
        <p className="mt-0.5 mb-2 text-xs text-ink-faint">{subtitle}</p>
      )}
      <ul className="mt-2 flex flex-col gap-1.5">
        {rows.map((row) => (
          <Row
            key={row.userId}
            row={row}
            practiceId={practiceId}
            canManage={canManage}
            isAdmin={isAdmin}
            submitted={submitted}
            showStatus={showStatus}
            viewerId={viewerId}
            onRun={onRun}
            onClearArrival={onClearArrival}
          />
        ))}
      </ul>
    </section>
  );
}

/** One person's line, and everything anybody is allowed to do to it.
 *
 * The control this replaced was a four-way status dropdown — Here, Late,
 * Excused, Unexcused — offered to choreographers and admins alike. Picking
 * "Here" wrote `minutesLate = 0`, so it silently deleted a fourteen-minute
 * lateness and the charge attached to it, and nobody found out until the
 * month's total was wrong.
 *
 * What's here instead:
 *
 * - **Late is never a choice.** It follows the minutes, and the minutes are
 *   what the check-in measured. There is nothing to pick that can contradict
 *   anything.
 * - **Choreographers get one button**, before they submit, for the one case
 *   they genuinely need: somebody whose phone died and who never checked in.
 *   It cannot touch a recorded lateness because it only appears where there
 *   is no check-in at all.
 * - **Everything else is a flag.** It reaches the AD with a name on it.
 */
function Row({
  row,
  practiceId,
  canManage,
  isAdmin,
  submitted,
  showStatus,
  viewerId,
  onRun,
  onClearArrival,
}: {
  row: PanelRow;
  practiceId: string;
  canManage: boolean;
  isAdmin: boolean;
  submitted: boolean;
  showStatus: boolean;
  viewerId: string;
  onRun: (fn: () => Promise<unknown>) => void;
  onClearArrival?: (userId: string) => void;
}) {
  const [flagging, setFlagging] = useState(false);
  const [flagText, setFlagText] = useState("");
  const [minutes, setMinutes] = useState(String(row.minutesLate ?? 0));

  // A choreographer may say "they were here" only where the app has no
  // check-in of its own. With one, the person has already said it better.
  const canMarkPresent = canManage && !submitted && !row.checkedInAt;
  // Anybody may flag their own row; choreographers and the AD may flag any.
  const canFlag = canManage || row.userId === viewerId;
  const corrected =
    row.measuredMinutesLate !== null &&
    row.minutesLate !== null &&
    row.measuredMinutesLate !== row.minutesLate;

  return (
    <li className="flex flex-col gap-1.5 rounded-lg bg-surface-2 px-3 py-2 bg-surface/60">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-medium text-ink">{row.name}</span>
        {row.role === "CHOREOGRAPHER" && (
          <span className="rounded bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent-ink">
            Choreographer
          </span>
        )}
        {row.plannedArriveAt && (
          <span className="text-xs text-ink-soft">
            due {timeFormatter.format(new Date(row.plannedArriveAt))}
          </span>
        )}
        {row.conflictTitle && !row.checkedInAt && (
          <span className="text-xs text-ink-soft">{row.conflictTitle}</span>
        )}
        {row.checkedInAt && (
          <span className="text-xs text-ink-soft">
            in at {timeFormatter.format(new Date(row.checkedInAt))}
          </span>
        )}
        {row.cameDespiteExcusal && (
          <span className="rounded bg-good-soft px-2 py-0.5 text-[10px] font-medium text-good">
            Came anyway, not charged
          </span>
        )}

        <span className="ml-auto flex items-center gap-2">
          {showStatus && (
            <AttendanceBadge status={row.status} minutesLate={row.minutesLate} />
          )}
          {corrected && (
            <span
              className="text-[10px] text-ink-faint"
              title={`The check-in measured ${row.measuredMinutesLate} minutes`}
            >
              was {row.measuredMinutesLate}
            </span>
          )}
          {row.isOverride && (
            <span className="text-[10px] uppercase text-ink-faint">edited</span>
          )}
          {onClearArrival && (
            <button
              onClick={() => onClearArrival(row.userId)}
              className="text-xs font-medium text-ink-soft hover:underline"
            >
              Remove
            </button>
          )}

          {canMarkPresent && !isAdmin && (
            <button
              onClick={() =>
                onRun(() => markAttendance(practiceId, row.userId, "CAME"))
              }
              className="rounded border border-line-strong px-2 py-0.5 text-xs font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent-ink"
            >
              They were here
            </button>
          )}

          {isAdmin && showStatus && (
            <select
              value={outcomeForStatus(row.status) ?? ""}
              onChange={(e) =>
                onRun(() =>
                  markAttendance(
                    practiceId,
                    row.userId,
                    e.target.value as AttendanceOutcome,
                  ),
                )
              }
              className="rounded-lg border border-line-strong bg-surface px-1.5 py-0.5 text-xs"
            >
              <option value="" disabled>
                Change…
              </option>
              {(["CAME", "EXCUSED", "UNEXCUSED"] as const).map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABELS[o]}
                </option>
              ))}
            </select>
          )}

          {canFlag && (
            <button
              onClick={() => setFlagging((v) => !v)}
              className="text-xs font-medium text-ink-soft hover:underline"
            >
              {flagging ? "Cancel" : "Flag"}
            </button>
          )}
        </span>
      </div>

      {/* Minutes, the AD's alone. This is the number that costs money, so it
          is the one thing a choreographer can never reach. */}
      {isAdmin && showStatus && row.attendanceId && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          <label htmlFor={`min-${row.userId}`}>Minutes late</label>
          <input
            id={`min-${row.userId}`}
            type="number"
            min={0}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="w-16 rounded border border-line-strong bg-surface px-1.5 py-0.5 tabular-nums text-ink"
          />
          <button
            disabled={minutes === String(row.minutesLate ?? 0)}
            onClick={() =>
              onRun(() => setMinutesLate(row.attendanceId!, Number(minutes)))
            }
            className="rounded bg-accent px-2 py-0.5 font-medium text-on-accent transition-opacity disabled:opacity-40"
          >
            Save
          </button>
          <span className="text-ink-faint">
            Re-prices the charge at that day&rsquo;s rates.
          </span>
        </div>
      )}

      {flagging && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={flagText}
            onChange={(e) => setFlagText(e.target.value)}
            placeholder={
              canManage
                ? "She was here from the start, her phone was dead"
                : "I was here on time, my phone wouldn't load"
            }
            className="min-w-48 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-sm text-ink"
          />
          <button
            disabled={flagText.trim() === ""}
            onClick={() => {
              const body = flagText;
              setFlagText("");
              setFlagging(false);
              onRun(() => raiseAttendanceFlag(practiceId, row.userId, body));
            }}
            className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-on-accent transition-opacity disabled:opacity-40"
          >
            Send to the AD
          </button>
        </div>
      )}
    </li>
  );
}

