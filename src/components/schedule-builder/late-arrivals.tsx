"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  removePlannedArrival,
  setPlannedArrival,
  suggestPlannedArrivals,
  type ArrivalSuggestion,
} from "@/lib/actions/planned-arrivals";
import { APP_TIME_ZONE } from "@/lib/timezone";

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
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
    <div className="mt-2 flex flex-col gap-1.5 border-t border-line pt-2 text-xs">
      {existing.map((arrival) => (
        <div
          key={arrival.userId}
          className="flex items-center gap-2 rounded-lg bg-info-soft px-2.5 py-1.5"
        >
          <span className="text-info">
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
            className="ml-auto font-medium text-ink-soft hover:underline"
          >
            Remove
          </button>
        </div>
      ))}

      {suggestions.map((s) => (
        <div
          key={s.userId}
          className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-2.5 py-1.5"
        >
          <span className="text-warn">
            <span className="font-medium">{s.name}</span>
            {s.conflictTitle ? ` — ${s.conflictTitle}` : ""} ends at{" "}
            {timeFormatter.format(new Date(s.conflictEndsAt))}
          </span>
          <button
            onClick={() => accept(s)}
            disabled={isPending}
            className="ml-auto rounded-lg bg-warn px-2 py-0.5 font-medium text-surface transition-colors hover:opacity-90 disabled:opacity-45"
          >
            Mark as arriving then
          </button>
        </div>
      ))}
    </div>
  );
}
