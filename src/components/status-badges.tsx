import type { AttendanceStatus } from "@/lib/attendance";

type ConflictStatus = "NOT_REVIEWED" | "EXCUSED" | "UNEXCUSED";

const CONFLICT_STYLES: Record<ConflictStatus, { label: string; className: string }> = {
  NOT_REVIEWED: {
    label: "Not reviewed",
    className: "bg-surface-3 text-ink-soft bg-surface-3 ",
  },
  EXCUSED: {
    label: "Excused",
    className:
      "bg-good-soft text-good  ",
  },
  UNEXCUSED: {
    label: "Unexcused",
    className: "bg-warn-soft text-warn  ",
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
      "bg-good-soft text-good  ",
  },
  LATE: {
    label: "Late",
    className: "bg-warn-soft text-warn  ",
  },
  EXCUSED_ABSENT: {
    label: "Excused",
    className: "bg-info-soft text-accent-ink  ",
  },
  UNEXCUSED_ABSENT: {
    label: "Unexcused",
    className: "bg-bad-soft text-bad  ",
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
      <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-ink-faint bg-surface-3">
        Not recorded
      </span>
    );
  }
  const style = ATTENDANCE_STYLES[status];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.className}`} >
      {style.label}
      {status === "LATE" && minutesLate ? ` ${minutesLate} min` : ""}
    </span>
  );
}
