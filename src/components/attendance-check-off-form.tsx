"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAttendance } from "@/lib/actions/attendance";
import { AttendanceBadge } from "@/components/attendance-badge";
import type { CastAttendanceRow } from "@/lib/attendance-data";

export function AttendanceCheckOffForm({
  practiceId,
  rows,
}: {
  practiceId: string;
  rows: CastAttendanceRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Default to everyone present on a fresh practice — marking the exceptions
  // is far less tapping than marking the whole cast.
  const [present, setPresent] = useState<Set<string>>(
    () =>
      new Set(
        rows.filter((r) => r.attended === null || r.attended).map((r) => r.userId),
      ),
  );

  function toggle(userId: string) {
    setSaved(false);
    setPresent((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await saveAttendance(practiceId, Array.from(present));
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save attendance");
      }
    });
  }

  const presentCount = present.size;
  const absentCount = rows.length - presentCount;

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {rows.map((row) => (
          <li
            key={row.userId}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <label className="flex flex-1 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={present.has(row.userId)}
                onChange={() => toggle(row.userId)}
                className="h-4 w-4"
              />
              <span className="text-sm text-zinc-900 dark:text-zinc-50">
                {row.name}
              </span>
              {row.role === "CHOREOGRAPHER" && (
                <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                  Choreographer
                </span>
              )}
            </label>
            {!present.has(row.userId) && <AttendanceBadge kind={row.kind} />}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={isPending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          {isPending ? "Saving…" : "Save attendance"}
        </button>
        <span className="text-sm text-zinc-500">
          {presentCount} present · {absentCount} absent
        </span>
        {saved && !isPending && (
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            Saved
          </span>
        )}
        {error && (
          <span className="text-sm font-medium text-red-600">{error}</span>
        )}
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Absences are automatically labelled excused or unexcused based on what
        that person logged in their conflicts for this time slot.
      </p>
    </div>
  );
}
