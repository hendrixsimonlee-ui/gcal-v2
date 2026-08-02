import { ABSENCE_LABELS, type AbsenceKind } from "@/lib/attendance";

const STYLES: Record<AbsenceKind, string> = {
  present:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  "excused-unavailable":
    "bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300",
  "excused-conflict":
    "bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300",
  "unexcused-conflict":
    "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  "no-show": "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

export function AttendanceBadge({ kind }: { kind: AbsenceKind | null }) {
  if (kind === null) {
    return (
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        Not marked
      </span>
    );
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[kind]}`}
    >
      {ABSENCE_LABELS[kind]}
    </span>
  );
}
