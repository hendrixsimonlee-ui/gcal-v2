"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkIn, getOpenCheckIns, type CheckInWindow } from "@/lib/actions/attendance";
import { APP_TIME_ZONE } from "@/lib/timezone";

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

/** The one thing that matters while a practice is running. Sits at the top of
 * My Schedule and only appears when there's actually something to check into,
 * so the screen stays quiet the rest of the time. */
export function CheckInCard({ initial }: { initial: CheckInWindow[] }) {
  const router = useRouter();
  const [windows, setWindows] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // A practice starting is the moment this becomes relevant, and the page may
  // already have been open for an hour by then.
  useEffect(() => {
    const timer = setInterval(() => {
      getOpenCheckIns().then(setWindows).catch(() => {});
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (windows.length === 0) return null;

  function tapIn(practiceId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await checkIn(practiceId);
        setWindows(await getOpenCheckIns());
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't check you in");
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-good/35 bg-good-soft p-4">
      <h2 className="text-sm font-semibold text-good">
        Happening right now
      </h2>

      {error && (
        <p className="text-sm font-medium text-bad">
          {error}
        </p>
      )}

      {windows.map((w) => (
        <div
          key={w.practiceId}
          className="flex flex-wrap items-center gap-3 rounded-xl bg-surface px-4 py-3"
        >
          <div className="flex flex-col">
            <span className="font-medium text-ink">
              {w.danceName}
            </span>
            <span className="text-xs text-ink-soft">
              {timeFormatter.format(new Date(w.startDateTime))}–
              {timeFormatter.format(new Date(w.endDateTime))}
              {w.spaceName ? ` · ${w.spaceName}` : ""} {w.plannedArriveAt &&
                ` · you're due at ${timeFormatter.format(new Date(w.plannedArriveAt))}`} </span>
          </div>

          <div className="ml-auto">
            {w.alreadyCheckedInAt ? (
              <span className="text-sm font-medium text-good">
                Checked in at{" "}
                {timeFormatter.format(new Date(w.alreadyCheckedInAt))}
                {w.minutesLate ? ` · ${w.minutesLate} min late` : ""}
              </span>
            ) : (
              <button
                onClick={() => tapIn(w.practiceId)}
                disabled={isPending}
                className="rounded-xl bg-good px-5 py-2.5 text-sm font-semibold text-surface transition-colors hover:opacity-90 disabled:opacity-45"
              >
                {isPending ? "…" : "Check in"}
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
