"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  submitWeeklyConflicts,
  unsubmitWeeklyConflicts,
} from "@/lib/actions/conflicts";
import { APP_TIME_ZONE } from "@/lib/timezone";

const stampFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "My conflicts for this week are in."
 *
 * Says nothing about whether you have any — an empty week is a perfectly good
 * answer, and the point is that it's an answer at all. Nothing is locked
 * afterwards: remembering a class on Wednesday and adding it is normal, and
 * the week stays submitted. */
export function SubmitWeekButton({
  weekOfIso,
  weekLabel,
  submittedAtIso,
  conflictCount,
}: {
  weekOfIso: string;
  weekLabel: string;
  submittedAtIso: string | null;
  conflictCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      if (submittedAtIso) await unsubmitWeeklyConflicts(weekOfIso);
      else await submitWeeklyConflicts(weekOfIso);
      router.refresh();
    });
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3 ${ submittedAtIso
          ? "border-good/35 bg-good-soft"
          : "border-warn/35 bg-warn-soft"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium ${ submittedAtIso ? "text-good" : "text-warn"
          }`}
        >
          {submittedAtIso
            ? `Week of ${weekLabel} is in`
            : `Week of ${weekLabel} isn't in yet`}
        </p>
        <p
          className={`mt-0.5 text-xs ${ submittedAtIso ? "text-good" : "text-warn"
          }`}
        >
          {submittedAtIso
            ? `Sent ${stampFormatter.format(new Date(submittedAtIso))}. You can still add or change conflicts — this stays in.`
            : conflictCount === 0
              ? "Nothing logged. If that's right, say so anyway — a blank week and an unanswered one look the same from the other side."
              : `${conflictCount} logged. Confirm you've checked the whole week so the AD can schedule around you.`}
        </p>
      </div>
      <button
        onClick={toggle}
        disabled={isPending}
        className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-45 ${ submittedAtIso
            ? "border border-good/40 text-good hover:bg-good/10"
            : "bg-accent text-on-accent hover:bg-accent-hover"
        }`}
      >
        {isPending
          ? "Saving…"
          : submittedAtIso
            ? "I need to change something"
            : "My conflicts are in"}
      </button>
    </div>
  );
}
