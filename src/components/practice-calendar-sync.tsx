"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  removeMyPracticesFromGoogle,
  syncMyPracticesToGoogle,
} from "@/lib/actions/calendar-export";

/** "Put all my rehearsals in my Google Calendar", once, for the whole term.
 *
 * Adding them one at a time was the only way before, which nobody does forty
 * times — so most of the team simply didn't have their rehearsals anywhere
 * except this app. Pressing it again after a reschedule updates the events
 * that are already there rather than leaving a second copy. */
export function PracticeCalendarSync() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function sync() {
    setMessage(null);
    setDetail([]);
    setError(null);
    startTransition(async () => {
      try {
        const result = await syncMyPracticesToGoogle();
        const changed = result.added + result.updated + result.removed;
        setMessage(
          result.practicesSeen === 0
            ? "You have no published rehearsals yet — nothing to add."
            : changed === 0
              ? `Already up to date: all ${result.practicesSeen} of your rehearsals are in ${result.calendarName}.`
              : `${result.added} added · ${result.updated} updated · ${result.removed} removed in ${result.calendarName}.`,
        );
        setDetail(result.failures);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work.");
      }
    });
  }

  function remove() {
    if (
      !confirm(
        "Remove every PADT rehearsal this app added to your Google Calendar?",
      )
    ) {
      return;
    }
    setMessage(null);
    setDetail([]);
    setError(null);
    startTransition(async () => {
      try {
        const result = await removeMyPracticesFromGoogle();
        setMessage(
          result.removed === 0
            ? "There was nothing of ours in your calendar to remove."
            : `Removed ${result.removed} rehearsal${result.removed === 1 ? "" : "s"} from your calendar.`,
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work.");
      }
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm text-ink-soft">
          Put every rehearsal you&rsquo;re called to straight into your Google
          Calendar — the whole term at once.
        </span>
        <button
          onClick={sync}
          disabled={isPending}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-45"
        >
          {isPending ? "Working…" : "Add all to my calendar"}
        </button>
        <button
          onClick={remove}
          disabled={isPending}
          className="text-sm font-medium text-ink-soft hover:underline disabled:opacity-45"
        >
          Take them back out
        </button>
      </div>

      <p className="mt-1.5 text-xs text-ink-faint">
        Safe to press again whenever the schedule changes — it updates the
        rehearsals already in your calendar instead of adding them twice, and
        takes out anything that got cancelled.
      </p>

      {message && (
        <p className="mt-2 text-sm font-medium text-good">{message}</p>
      )}
      {detail.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1">
          {detail.map((line, i) => (
            <li
              key={i}
              className="rounded-lg bg-warn-soft px-2.5 py-2 text-xs text-warn"
            >
              {line}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm font-medium text-bad">{error}</p>}
    </div>
  );
}
