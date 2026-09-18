"use client";

import { useState, useTransition } from "react";
import { addCredit, removeCredit } from "@/lib/actions/dues";

/** Plus and minus for logging what somebody did at a club meeting.
 *
 * Built for the meeting itself rather than for tidying up afterwards: the AD
 * is reading names off a list while people talk over each other, so the count
 * moves the instant it is tapped and catches up with the server behind them.
 * A minus takes back the most recent one of that kind, which is what a mis-tap
 * needs. */
export function CreditStepper({
  userId,
  categoryId,
  term,
  count,
  readOnly,
}: {
  userId: string;
  categoryId: string;
  term: string;
  count: number;
  /** A retired category still shows its counts, but nothing new goes on it. */
  readOnly?: boolean;
}) {
  const [shown, setShown] = useState(count);
  const [isPending, startTransition] = useTransition();

  function step(delta: 1 | -1) {
    if (delta === -1 && shown === 0) return;
    setShown((n) => n + delta);
    startTransition(async () => {
      try {
        if (delta === 1) await addCredit(userId, categoryId, term);
        else await removeCredit(userId, categoryId, term);
      } catch {
        setShown((n) => n - delta);
      }
    });
  }

  if (readOnly) {
    return (
      <span className="text-sm tabular-nums text-ink-faint">{shown}</span>
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={isPending || shown === 0}
        aria-label="One fewer"
        className="grid size-6 place-content-center rounded border border-line-strong text-sm leading-none text-ink-soft transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-30"
      >
        &minus;
      </button>
      <span className="w-5 text-center text-sm font-medium tabular-nums text-ink">
        {shown}
      </span>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={isPending}
        aria-label="One more"
        className="grid size-6 place-content-center rounded border border-line-strong text-sm leading-none text-ink-soft transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-30"
      >
        +
      </button>
    </div>
  );
}
