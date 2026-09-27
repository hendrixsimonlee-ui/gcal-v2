"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  resolveAttendanceFlag,
  type FlagRow,
} from "@/lib/actions/attendance-flags";
import { APP_TIME_ZONE } from "@/lib/timezone";

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
});

/** What choreographers and the app are waiting on you to decide.
 *
 * Choreographers can't change attendance any more — that is how a fourteen
 * minute lateness became "here" and a charge disappeared with nobody the
 * wiser. They still know what happened in the room better than anyone, so the
 * knowledge arrives here instead, with a name attached.
 *
 * Marking one done doesn't change any record. The fix happens on the practice
 * itself; this is the reminder that it needs one. */
export function FlagQueue({ flags }: { flags: FlagRow[] }) {
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const open = flags.filter((f) => !cleared.has(f.id));

  return (
    <section className="rounded-xl border border-info/35 bg-info-soft p-4">
      <h2 className="text-sm font-semibold text-info">
        Waiting on you ({open.length})
      </h2>
      {open.length === 0 ? (
        <p className="mt-1 text-sm text-info">
          Nothing flagged. Choreographers raise these when a record looks wrong
          to them.
        </p>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {open.map((flag) => (
            <FlagRowItem
              key={flag.id}
              flag={flag}
              onCleared={() => setCleared((c) => new Set(c).add(flag.id))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FlagRowItem({
  flag,
  onCleared,
}: {
  flag: FlagRow;
  onCleared: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg bg-surface px-3 py-2 text-sm">
      <span className="font-medium text-ink">{flag.subjectName}</span>
      <Link
        href={`/attendance/${flag.practiceId}`}
        className="text-ink-soft underline underline-offset-2"
      >
        {flag.danceName}, {dayFormatter.format(new Date(flag.startIso))}
      </Link>
      <span className="text-ink">{flag.body}</span>
      <span className="text-xs text-ink-faint">
        {flag.isAutomatic ? "— noticed by the app" : `— ${flag.raisedByName}`}
      </span>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await resolveAttendanceFlag(flag.id);
            onCleared();
          })
        }
        className="ml-auto rounded border border-line-strong px-2 py-0.5 text-xs font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-40"
      >
        Done
      </button>
    </li>
  );
}
