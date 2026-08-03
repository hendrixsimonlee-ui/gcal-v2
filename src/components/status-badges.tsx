import type { AttendanceStatus } from "@/lib/attendance";

type ConflictStatus = "NOT_REVIEWED" | "EXCUSED" | "UNEXCUSED";

const CONFLICT_STYLES: Record<ConflictStatus, { label: string; className: string }> = {
  NOT_REVIEWED: {
    label: "Not reviewed",
    className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  },
  EXCUSED: {
    label: "Excused",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  UNEXCUSED: {
    label: "Unexcused",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
};

export function ConflictStatusBadge({ status }: { status: ConflictStatus }) {
  const style = CONFLICT_STYLES[status];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}

const ATTENDANCE_STYLES: Record<
  AttendanceStatus,
  { label: string; className: string }
> = {
  PRESENT: {
    label: "Here",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  LATE: {
    label: "Late",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  EXCUSED_ABSENT: {
    label: "Excused",
    className: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  },
  UNEXCUSED_ABSENT: {
    label: "Unexcused",
    className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  },
};

export function AttendanceBadge({
  status,
  minutesLate,
}: {
  status: AttendanceStatus | null;
  minutesLate?: number | null;
}) {
  if (status === null) {
    return (
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-400 dark:bg-zinc-800">
        Not recorded
      </span>
    );
  }
  const style = ATTENDANCE_STYLES[status];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.className}`}
    >
      {style.label}
      {status === "LATE" && minutesLate ? ` ${minutesLate} min` : ""}
    </span>
  );
}
