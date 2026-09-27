"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { applyMeasuredMinutes, keepChargedMinutes } from "@/lib/actions/dues";
import { APP_TIME_ZONE } from "@/lib/timezone";

export type RecheckItem = {
  attendanceId: string;
  practiceId: string;
  danceName: string;
  startIso: string;
  name: string;
  chargedMinutes: number;
  measuredMinutes: number;
};

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
});

/** Lateness the app measured but isn't charging for.
 *
 * For a term, changing somebody's status also wrote their minutes to zero, so
 * marking a person "here" deleted the fourteen minutes they were late by and
 * the fee with them. The check-in times survived, so the real figures were
 * recoverable, and the migration worked them out again — without moving a
 * single charge.
 *
 * This is where that difference gets decided, one row at a time. Nothing has
 * changed what anybody owes yet, which is the point: quietly reinstating a
 * term of fees would hand people bills they were told they didn't have. */
export function RecheckPanel({ items }: { items: RecheckItem[] }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const remaining = items.filter((i) => !done.has(i.attendanceId));

  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-warn/35 bg-warn-soft p-4">
      <h2 className="text-sm font-semibold text-warn">
        Lateness to re-check ({remaining.length})
      </h2>
      <p className="mt-0.5 max-w-3xl text-xs text-warn">
        These people checked in late, but nothing is being charged and nobody
        is on record as having decided that. It is almost certainly an old bug
        that erased the minutes when somebody&rsquo;s status was changed.
        Nothing has moved yet — you decide each one.
      </p>

      {remaining.length === 0 ? (
        <p className="mt-3 text-sm text-warn">
          All done. Nothing left to look at.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {remaining.map((item) => (
            <RecheckRow
              key={item.attendanceId}
              item={item}
              onDone={() => setDone((d) => new Set(d).add(item.attendanceId))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecheckRow({
  item,
  onDone,
}: {
  item: RecheckItem;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(work: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await work();
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't save.");
      }
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface px-3 py-2 text-sm">
      <span className="font-medium text-ink">{item.name}</span>
      <Link
        href={`/attendance/${item.practiceId}`}
        className="text-ink-soft underline underline-offset-2"
      >
        {item.danceName}, {dayFormatter.format(new Date(item.startIso))}
      </Link>
      <span className="text-ink-soft">
        checked in{" "}
        <span className="font-medium text-ink">{item.measuredMinutes} min</span>{" "}
        late, charged as {item.chargedMinutes}
      </span>

      <span className="ml-auto flex items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => applyMeasuredMinutes(item.attendanceId))}
          className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-on-accent transition-opacity disabled:opacity-40"
        >
          Charge the {item.measuredMinutes}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => keepChargedMinutes(item.attendanceId))}
          className="rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-40"
        >
          Leave it
        </button>
      </span>

      {error && <p className="w-full text-xs text-bad">{error}</p>}
    </li>
  );
}
