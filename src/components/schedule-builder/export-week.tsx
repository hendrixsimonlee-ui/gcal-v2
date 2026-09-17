"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  exportWeekToTeamCalendar,
  type TeamCalendarExport,
} from "@/lib/actions/spaces";

/** "Send this week to Google Calendar."
 *
 * Publishing already writes to the shared team calendar. This button exists
 * because it used to do that silently — the sync result was thrown away, so
 * an AD who had never linked a calendar in Settings was told "published 6
 * practices" while nothing reached Google, and there was no way to tell from
 * inside the app. This says what actually happened, in numbers.
 *
 * It's safe to press twice: each practice remembers its calendar event, so a
 * second run updates the same events rather than making duplicates. */
export function ExportWeek({
  weekOfIso,
  weekLabel,
}: {
  weekOfIso: string;
  weekLabel: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<TeamCalendarExport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function send() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await exportWeekToTeamCalendar(weekOfIso));
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Couldn't reach Google Calendar.",
        );
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={send}
          disabled={isPending}
          className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-45"
        >
          {isPending ? "Sending…" : `Send ${weekLabel} to Google Calendar`}
        </button>
        <span className="text-xs text-ink-soft">
          Published practices only — drafts stay off the calendar the team
          reads.
        </span>
      </div>

      {error && <p className="text-xs font-medium text-bad">{error}</p>}

      {result && <ExportResult result={result} weekLabel={weekLabel} />}
    </div>
  );
}

function ExportResult({
  result,
  weekLabel,
}: {
  result: TeamCalendarExport;
  weekLabel: string;
}) {
  // The case this button was built for. Nothing is broken — the app has
  // nowhere to write to — so it names the screen that fixes it rather than
  // reporting a failure.
  if (!result.linked) {
    return (
      <p className="text-xs text-warn">
        <span className="font-medium">
          No shared calendar is linked yet, so nothing was sent.
        </span>{" "}
        Link one under{" "}
        <Link href="/admin/settings" className="underline">
          Settings → Shared team calendar
        </Link>
        , then press this again. Until then, publishing tells everyone in the
        app but doesn&rsquo;t reach Google.
      </p>
    );
  }

  if (result.published === 0) {
    return (
      <p className="text-xs text-ink-soft">
        Nothing published in {weekLabel} yet
        {result.drafts > 0
          ? ` — ${result.drafts} draft${result.drafts === 1 ? "" : "s"} waiting. Publish first, then send.`
          : "."}
      </p>
    );
  }

  const where = result.calendarName ?? "the team calendar";

  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <p className={result.failed > 0 ? "text-warn" : "text-good"}>
        <span className="font-medium">
          {result.written} of {result.published}
        </span>{" "}
        {result.published === 1 ? "practice" : "practices"} sent to {where}.
      </p>
      {result.failed > 0 && (
        <p className="text-warn">
          {result.failed}{" "}
          {result.failed === 1 ? "practice" : "practices"} couldn&rsquo;t be
          written.{" "}
          {/* The actual reason from Google, where there is one. This used to
              blame an expired sign-in every time, which was sometimes true
              and sometimes sent the AD to fix the wrong thing. */}
          {result.problem ??
            "Sign out and back in, tick the calendar boxes, then try again."}
        </p>
      )}
      {result.drafts > 0 && (
        <p className="text-ink-soft">
          {result.drafts} draft{result.drafts === 1 ? "" : "s"} in this week{" "}
          {result.drafts === 1 ? "was" : "were"} left off — publish{" "}
          {result.drafts === 1 ? "it" : "them"} to put {result.drafts === 1 ? "it" : "them"} on
          the calendar.
        </p>
      )}
    </div>
  );
}
