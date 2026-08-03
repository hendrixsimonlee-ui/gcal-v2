"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  removePlannedArrival,
  setPlannedArrival,
  suggestPlannedArrivals,
  type ArrivalSuggestion,
} from "@/lib/actions/planned-arrivals";

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

export interface ExistingArrival {
  userId: string;
  name: string;
  arriveAt: string;
}

/** Late arrivals for one practice, entered while scheduling rather than
 * explained again every week.
 *
 * The suggestions are the point: a class that ends 15 minutes into a practice
 * is already in the data as a conflict, so the AD shouldn't have to notice it
 * and type the time out — one tap turns it into an agreed arrival. */
export function LateArrivals({
  practiceId,
  existing,
}: {
  practiceId: string;
  existing: ExistingArrival[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [suggestions, setSuggestions] = useState<ArrivalSuggestion[]>([]);

  useEffect(() => {
    let cancelled = false;
    suggestPlannedArrivals(practiceId)
      .then((result) => {
        if (!cancelled) setSuggestions(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [practiceId, existing.length]);

  function accept(s: ArrivalSuggestion) {
    startTransition(async () => {
      await setPlannedArrival(
        practiceId,
        s.userId,
        new Date(s.conflictEndsAt).toISOString(),
        s.conflictTitle,
      );
      setSuggestions((prev) => prev.filter((x) => x.userId !== s.userId));
      router.refresh();
    });
  }

  if (existing.length === 0 && suggestions.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-zinc-100 pt-2 text-xs dark:border-zinc-800">
      {existing.map((arrival) => (
        <div
          key={arrival.userId}
          className="flex items-center gap-2 rounded-lg bg-sky-50 px-2.5 py-1.5 dark:bg-sky-950/60"
        >
          <span className="text-sky-900 dark:text-sky-200">
            <span className="font-medium">{arrival.name}</span> arrives{" "}
            {timeFormatter.format(new Date(arrival.arriveAt))}
          </span>
          <button
            onClick={() =>
              startTransition(async () => {
                await removePlannedArrival(practiceId, arrival.userId);
                router.refresh();
              })
            }
            disabled={isPending}
            className="ml-auto font-medium text-zinc-500 hover:underline"
          >
            Remove
          </button>
        </div>
      ))}

      {suggestions.map((s) => (
        <div
          key={s.userId}
          className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 dark:bg-amber-950/60"
        >
          <span className="text-amber-900 dark:text-amber-200">
            <span className="font-medium">{s.name}</span>
            {s.conflictTitle ? ` — ${s.conflictTitle}` : ""} ends at{" "}
            {timeFormatter.format(new Date(s.conflictEndsAt))}
          </span>
          <button
            onClick={() => accept(s)}
            disabled={isPending}
            className="ml-auto rounded-md bg-amber-600 px-2 py-0.5 font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-40"
          >
            Mark as arriving then
          </button>
        </div>
      ))}
    </div>
  );
}
