"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setWeekReviewed,
  type AttendanceWeekRow,
} from "@/lib/actions/attendance";

/** Attendance, week by week, with the AD's own reviewed tick.
 *
 * The review screen used to be one list that grew all term, so "have I looked
 * at this?" had no answer anywhere in the app. Ticking a week locks its
 * records against further edits — which is the point, since the AD is
 * reviewing them — and reopening is one click, so the tick is a working state
 * rather than a decision you have to be sure about. */
export function AttendanceArchive({ weeks }: { weeks: AttendanceWeekRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(weeks);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(row: AttendanceWeekRow) {
    setError(null);
    startTransition(async () => {
      try {
        await setWeekReviewed(row.weekOfIso, row.reviewedAtIso === null);
        setRows((prev) =>
          prev.map((r) =>
            r.weekOfIso === row.weekOfIso
              ? {
                  ...r,
                  reviewedAtIso:
                    r.reviewedAtIso === null ? new Date().toISOString() : null,
                }
              : r,
          ),
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work.");
      }
    });
  }

  const open = rows.filter((r) => r.reviewedAtIso === null).length;

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Week by week</h2>
        <p className="text-xs text-ink-soft">
          {open === 0
            ? "Every week reviewed."
            : `${open} ${open === 1 ? "week" : "weeks"} still to review`}
        </p>
      </div>
      <p className="mb-3 text-xs text-ink-soft">
        Ticking a week locks its attendance so it can&rsquo;t drift after
        you&rsquo;ve been through it. Reopen it any time — nothing is thrown
        away.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-soft">
          No practices have happened yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((row) => (
            <li
              key={row.weekOfIso}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
            >
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.reviewedAtIso !== null}
                  disabled={isPending}
                  onChange={() => toggle(row)}
                />
                <span className="font-medium text-ink">
                  Week of {row.weekLabel}
                </span>
              </label>

              <span className="text-xs tabular-nums text-ink-soft">
                {row.practiceCount}{" "}
                {row.practiceCount === 1 ? "practice" : "practices"} ·{" "}
                {row.submittedCount} signed off
              </span>
              <span className="text-xs tabular-nums text-ink-soft">
                {row.presentCount} there
                {row.lateCount > 0 && ` · ${row.lateCount} late`}
                {row.unexcusedCount > 0 && (
                  <span className="text-bad"> · {row.unexcusedCount} unexcused</span>
                )}
              </span>

              <span className="ml-auto text-xs">
                {row.reviewedAtIso ? (
                  <span className="rounded-full bg-good-soft px-2 py-0.5 font-medium text-good">
                    Reviewed
                    {row.reviewedByName ? ` by ${row.reviewedByName}` : ""}
                  </span>
                ) : row.submittedCount < row.practiceCount ? (
                  <span className="rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn">
                    {row.practiceCount - row.submittedCount} waiting on a
                    choreographer
                  </span>
                ) : (
                  <span className="text-ink-faint">Ready to review</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-sm font-medium text-bad">{error}</p>}
    </section>
  );
}
