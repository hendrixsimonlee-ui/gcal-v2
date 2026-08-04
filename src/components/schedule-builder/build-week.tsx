"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyWeekProposal,
  proposeWeek,
  type BuildWeekProposal,
} from "@/lib/actions/build-week";
import { APP_TIME_ZONE } from "@/lib/timezone";

const slotFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** Solves the whole week at once and shows the result before writing
 * anything. The AD sees what each choice costs — who can't make it — and
 * accepts or discards. Accepting creates drafts, not confirmed practices,
 * so publishing is still a deliberate act. */
export function BuildWeek({ weekOfIso }: { weekOfIso: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [proposal, setProposal] = useState<BuildWeekProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<number | null>(null);

  function propose() {
    setError(null);
    setApplied(null);
    startTransition(async () => {
      try {
        setProposal(await proposeWeek(weekOfIso));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't build the week.");
      }
    });
  }

  function accept() {
    if (!proposal) return;
    startTransition(async () => {
      try {
        const { created } = await applyWeekProposal(proposal);
        setApplied(created);
        setProposal(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save the drafts.");
      }
    });
  }

  const totalCast = proposal?.placements.reduce((s, p) => s + p.castSize, 0) ?? 0;

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            Build the week
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Places every dance that still needs a slot, all at once, to get as
            many people into as many practices as possible.
          </p>
        </div>
        <button
          onClick={propose}
          disabled={isPending}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-45"
        >
          {isPending ? "Working…" : proposal ? "Try again" : "Build the week"}
        </button>
      </div>

      {applied !== null && (
        <p className="mt-3 text-sm font-medium text-good">
          {applied === 0
            ? "Nothing to add — those slots were taken in the meantime."
            : `Added ${applied} draft ${applied === 1 ? "practice" : "practices"}. Review them below, then publish.`}
        </p>
      )}

      {proposal && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <span className="font-medium text-ink">
              {proposal.placements.length}{" "}
              {proposal.placements.length === 1 ? "dance" : "dances"} placed
            </span>
            <span className="tabular-nums text-ink-soft">
              {proposal.totalExpectedAttendance} of {totalCast} people expected
            </span>
          </div>

          {proposal.placements.length > 0 && (
            <ul className="flex flex-col divide-y divide-line">
              {proposal.placements.map((p) => (
                <li
                  key={p.danceId}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2"
                >
                  <div>
                    <span className="text-sm font-medium text-ink">
                      {p.danceName}
                    </span>
                    <span className="ml-2 text-sm text-ink-soft">
                      {slotFormatter.format(new Date(p.startIso))} ·{" "}
                      {p.spaceName}
                    </span>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-sm font-medium tabular-nums ${ p.expectedCount === p.castSize
                          ? "text-good"
                          : "text-ink-soft"
                      }`}
                    >
                      {p.expectedCount}/{p.castSize}
                    </span>
                    {p.missingNames.length > 0 && (
                      <p className="text-xs text-ink-soft">
                        without {p.missingNames.join(", ")}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {proposal.unplaced.length > 0 && (
            <div className="rounded-lg border border-warn/35 bg-warn-soft p-3">
              <h3 className="text-sm font-semibold text-warn">
                Couldn&rsquo;t place {proposal.unplaced.length}
              </h3>
              <ul className="mt-1 flex flex-col gap-1">
                {proposal.unplaced.map((u) => (
                  <li
                    key={u.danceId}
                    className="text-xs text-warn"
                  >
                    <span className="font-medium">{u.danceName}</span> —{" "}
                    {u.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {proposal.placements.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={accept}
                disabled={isPending}
                className="rounded-lg bg-good px-3 py-1.5 text-sm font-medium text-surface transition-colors hover:opacity-90 disabled:opacity-45"
              >
                Add these as drafts
              </button>
              <button
                onClick={() => setProposal(null)}
                disabled={isPending}
                className="text-sm font-medium text-ink-soft hover:underline disabled:opacity-45"
              >
                Discard
              </button>
              <span className="text-xs text-ink-soft">
                Drafts only — you can still move them, and nobody is notified
                until you publish.
              </span>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm font-medium text-bad">
          {error}
        </p>
      )}
    </section>
  );
}
