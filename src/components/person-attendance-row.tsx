"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { overrideAttendance } from "@/lib/actions/attendance";
import { AttendanceBadge } from "@/components/status-badges";
import type { AttendanceStatus } from "@/lib/attendance";
import { APP_TIME_ZONE } from "@/lib/timezone";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

/** One practice on a person's record, with the AD's override in reach.
 *
 * The whole point of this screen is settling a question, so changing the
 * answer has to be possible from the same row you're reading. */
export function PersonAttendanceRow({
  practiceId,
  userId,
  danceName,
  danceArchived,
  spaceName,
  startDateTime,
  status,
  minutesLate,
  checkedInAt,
  isOverride,
}: {
  practiceId: string;
  userId: string;
  danceName: string;
  danceArchived: boolean;
  spaceName: string | null;
  startDateTime: string;
  status: AttendanceStatus | null;
  minutesLate: number | null;
  checkedInAt: string | null;
  isOverride: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-2 px-3 py-2 text-sm bg-surface/60">
      <span className="font-medium text-ink">
        {danceName}
      </span>
      {danceArchived && (
        <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-ink-soft">
          archived
        </span>
      )}
      <span className="text-ink-soft">
        {dateFormatter.format(new Date(startDateTime))}
      </span>
      {spaceName && (
        <span className="text-xs text-ink-soft">{spaceName}</span>
      )}
      {checkedInAt && (
        <span className="text-xs text-ink-soft">
          in at {timeFormatter.format(new Date(checkedInAt))}
        </span>
      )}

      <span className="ml-auto flex items-center gap-2">
        <AttendanceBadge status={status} minutesLate={minutesLate} />
        {isOverride && (
          <span className="text-[10px] uppercase text-ink-faint">edited</span>
        )}
        <select
          value={status ?? ""}
          disabled={isPending}
          onChange={(e) =>
            startTransition(async () => {
              await overrideAttendance(
                practiceId,
                userId,
                e.target.value as AttendanceStatus,
              );
              router.refresh();
            })
          }
          className="rounded-lg border border-line-strong px-1.5 py-0.5 text-xs disabled:opacity-45 bg-surface-3"
        >
          <option value="" disabled>
            Change…
          </option>
          <option value="PRESENT">Here</option>
          <option value="LATE">Late</option>
          <option value="EXCUSED_ABSENT">Excused</option>
          <option value="UNEXCUSED_ABSENT">Unexcused</option>
        </select>
        <Link
          href={`/attendance/${practiceId}`}
          className="text-xs font-medium text-accent-ink hover:underline"
        >
          Open
        </Link>
      </span>
    </li>
  );
}
