"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ANY_SPACE } from "@/lib/constants";
import {
  confirmAllDrafts,
  confirmPractice,
  createDraftPractice,
  deletePractice,
  getCandidateSlots,
  getSchedulingSidebarData,
  setChoreographerWeeklyExcuse,
  updatePracticeTime,
  type SidebarCastMember,
} from "@/lib/actions/schedule";
import type { CandidateSlot } from "@/lib/scheduling";
import { startOfWeek } from "@/lib/dates";
import {
  ScheduleCalendar,
  type PracticeEvent,
} from "@/components/schedule-builder/schedule-calendar";
import { WeekTracker } from "@/components/schedule-builder/week-tracker";
import { ConflictStatusBadge } from "@/components/status-badges";
import { LateArrivals } from "@/components/schedule-builder/late-arrivals";

interface DanceOption {
  id: string;
  name: string;
  castUserIds: string[];
  defaultDurationMinutes: number;
}

interface SpaceOption {
  id: string;
  name: string;
  availabilities: {
    id: string;
    dayOfWeek: number | null;
    startTime: string | null;
    endTime: string | null;
  }[];
}

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function ScheduleBuilder({
  dances,
  spaces,
  initialPractices,
}: {
  dances: DanceOption[];
  spaces: SpaceOption[];
  initialPractices: PracticeEvent[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [danceId, setDanceId] = useState(dances[0]?.id ?? "");
  // Default to searching every room — picking a specific one is the exception.
  const [spaceId, setSpaceId] = useState<string>(ANY_SPACE);
  const [durationMinutes, setDurationMinutes] = useState(
    dances[0]?.defaultDurationMinutes ?? 90,
  );
  const [ignoredUserIds, setIgnoredUserIds] = useState<Set<string>>(new Set());
  const [candidates, setCandidates] = useState<CandidateSlot[]>([]);
  const [sidebar, setSidebar] = useState<SidebarCastMember[]>([]);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  // Candidates are client state, so router.refresh() alone won't recompute
  // them. Every mutation bumps this so the list reflects the new practices
  // (a fresh draft holds its room, so it must drop out of the suggestions).
  const [refreshKey, setRefreshKey] = useState(0);
  const [visibleRange, setVisibleRange] = useState<{ start: Date; end: Date }>(
    () => {
      const start = startOfWeek(new Date());
      const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
      return { start, end };
    },
  );

  const ignoredKey = useMemo(
    () => Array.from(ignoredUserIds).sort().join(","),
    [ignoredUserIds],
  );

  useEffect(() => {
    if (!danceId || !spaceId) return;
    let cancelled = false;
    getCandidateSlots(danceId, spaceId, durationMinutes, Array.from(ignoredUserIds)).then(
      (result) => {
        if (!cancelled) setCandidates(result);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [danceId, spaceId, durationMinutes, ignoredKey, refreshKey]);

  useEffect(() => {
    if (!danceId) return;
    let cancelled = false;
    const weekOf = startOfWeek(visibleRange.start).toISOString();
    getSchedulingSidebarData(
      danceId,
      weekOf,
      visibleRange.start.toISOString(),
      visibleRange.end.toISOString(),
    ).then((result) => {
      if (!cancelled) setSidebar(result);
    });
    return () => {
      cancelled = true;
    };
  }, [danceId, visibleRange]);

  /** Switching dances also pulls in that piece's usual practice length, so
   * the AD isn't retyping the duration for every dance in the tracker. */
  function selectDance(nextDanceId: string) {
    setDanceId(nextDanceId);
    const dance = dances.find((d) => d.id === nextDanceId);
    if (dance) setDurationMinutes(dance.defaultDurationMinutes);
  }

  function toggleIgnored(userId: string) {
    setIgnoredUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function toggleChoreographerExcuse(userId: string, currentlyExcused: boolean) {
    const weekOf = startOfWeek(visibleRange.start).toISOString();
    startTransition(async () => {
      await setChoreographerWeeklyExcuse(danceId, userId, weekOf, !currentlyExcused);
      const result = await getSchedulingSidebarData(
        danceId,
        weekOf,
        visibleRange.start.toISOString(),
        visibleRange.end.toISOString(),
      );
      setSidebar(result);
      setRefreshKey((k) => k + 1);
      router.refresh();
    });
  }

  function applyCandidate(candidate: CandidateSlot) {
    startTransition(async () => {
      // Book the room this candidate was actually scored against, not
      // whatever the dropdown says (it may be "Any space").
      await createDraftPractice(
        danceId,
        candidate.spaceId,
        candidate.startDateTime.toISOString(),
        candidate.endDateTime.toISOString(),
      );
      setRefreshKey((k) => k + 1);
      router.refresh();
    });
  }

  function handleSelectRange(startIso: string, endIso: string) {
    startTransition(async () => {
      await createDraftPractice(danceId, spaceId, startIso, endIso);
      setRefreshKey((k) => k + 1);
      router.refresh();
    });
  }

  function handleEventMove(practiceId: string, startIso: string, endIso: string) {
    startTransition(async () => {
      await updatePracticeTime(practiceId, startIso, endIso);
      setRefreshKey((k) => k + 1);
      router.refresh();
    });
  }

  const businessHours = useMemo(() => {
    const relevant =
      spaceId === ANY_SPACE ? spaces : spaces.filter((s) => s.id === spaceId);
    return relevant.flatMap((space) =>
      space.availabilities
        .filter((a) => a.dayOfWeek !== null && a.startTime && a.endTime)
        .map((a) => ({
          daysOfWeek: [a.dayOfWeek!],
          startTime: a.startTime!,
          endTime: a.endTime!,
        })),
    );
  }, [spaces, spaceId]);

  const draftPracticesForDance = initialPractices.filter(
    (p) => p.danceId === danceId && p.status === "PROPOSED",
  );
  const allDrafts = initialPractices.filter((p) => p.status === "PROPOSED");

  function publishAll() {
    if (
      !confirm(
        `Confirm all ${allDrafts.length} draft practice${allDrafts.length === 1 ? "" : "s"} and notify everyone involved?`,
      )
    ) {
      return;
    }
    setPublishResult(null);
    startTransition(async () => {
      const result = await confirmAllDrafts();
      setPublishResult(
        `Published ${result.confirmed} practice${result.confirmed === 1 ? "" : "s"} · notified ${result.peopleNotified} ${result.peopleNotified === 1 ? "person" : "people"}`,
      );
      setRefreshKey((k) => k + 1);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Schedule Builder
      </h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">Dance</label>
          <select
            value={danceId}
            onChange={(e) => selectDance(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            {dances.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">Space</label>
          <select
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value={ANY_SPACE}>Any space</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">
            Duration (minutes)
          </label>
          <input
            type="number"
            min={15}
            step={15}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value) || 90)}
            className="w-28 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        {isPending && (
          <span className="pb-2 text-xs text-zinc-400">Saving…</span>
        )}
      </div>

      {/* Publishing is a deliberate, separate step: the AD lays out the whole
          term as drafts, then tells everyone once. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-sm">
          {allDrafts.length === 0 ? (
            <span className="text-zinc-500 dark:text-zinc-400">
              No unpublished drafts. Nothing is waiting to be announced.
            </span>
          ) : (
            <>
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {allDrafts.length} draft practice
                {allDrafts.length === 1 ? "" : "s"} not yet published
              </span>
              <span className="ml-2 text-zinc-500 dark:text-zinc-400">
                — drafts hold their room but nobody has been told about them
                yet.
              </span>
            </>
          )}
          {publishResult && (
            <span className="ml-2 font-medium text-emerald-600 dark:text-emerald-400">
              {publishResult}
            </span>
          )}
        </div>
        <button
          onClick={publishAll}
          disabled={isPending || allDrafts.length === 0}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
        >
          {isPending ? "Publishing…" : "Publish schedule"}
        </button>
      </div>

      <WeekTracker
        weekOf={startOfWeek(visibleRange.start)}
        refreshKey={refreshKey}
        selectedDanceId={danceId}
        onPickDance={selectDance}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_280px]">
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Best candidates
          </h2>
          {candidates.length === 0 && (
            <p className="text-xs text-zinc-500">
              No open slots found in the next 4 weeks for this space/duration.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {candidates.map((c, i) => (
              <li
                key={c.startDateTime.toISOString()}
                className="rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-700"
              >
                <div className="font-medium text-zinc-800 dark:text-zinc-200">
                  #{i + 1} {timeFormatter.format(c.startDateTime)}
                </div>
                <div className="text-zinc-600 dark:text-zinc-300">
                  {c.spaceName}
                </div>
                <div className="text-zinc-500">
                  {c.conflictedCastMembers.length > 0
                    ? `${new Set(c.conflictedCastMembers.map((m) => m.userId)).size} affected`
                    : "Everyone free"}
                </div>
                <button
                  onClick={() => applyCandidate(c)}
                  className="mt-1 rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
                >
                  Use this slot
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
          <ScheduleCalendar
            practices={initialPractices}
            candidates={candidates}
            businessHours={businessHours}
            onSelectRange={handleSelectRange}
            onEventMove={handleEventMove}
            onDatesSet={(start, end) => setVisibleRange({ start, end })}
          />
          {draftPracticesForDance.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
              {draftPracticesForDance.map((p) => (
                <div
                  key={p.id}
                  className="flex w-full flex-col gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                >
                  <div className="flex items-center gap-2">
                  {timeFormatter.format(new Date(p.startDateTime))}
                  <button
                    onClick={() =>
                      startTransition(async () => {
                        await confirmPractice(p.id);
                        setRefreshKey((k) => k + 1);
                        router.refresh();
                      })
                    }
                    className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() =>
                      startTransition(async () => {
                        await deletePractice(p.id);
                        setRefreshKey((k) => k + 1);
                        router.refresh();
                      })
                    }
                    className="font-medium text-red-600 hover:underline"
                  >
                    Discard
                  </button>
                  </div>
                  <LateArrivals
                    practiceId={p.id}
                    existing={p.plannedArrivals ?? []}
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Cast &amp; conflicts this week
          </h2>
          <div className="flex flex-col gap-3">
            {sidebar
              .filter((m) => m.role === "CHOREOGRAPHER")
              .map((m) => (
                <div key={m.userId} className="text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {m.name}{" "}
                      <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                        Choreographer
                      </span>
                    </span>
                    <label className="flex items-center gap-1 text-zinc-500">
                      <input
                        type="checkbox"
                        checked={m.excusedThisWeek}
                        onChange={() =>
                          toggleChoreographerExcuse(m.userId, m.excusedThisWeek)
                        }
                      />
                      Excused this week
                    </label>
                  </div>
                  <ConflictList conflicts={m.conflicts} />
                </div>
              ))}

            {sidebar
              .filter((m) => m.role === "DANCER")
              .map((m) => (
                <div key={m.userId} className="text-xs">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={ignoredUserIds.has(m.userId)}
                      onChange={() => toggleIgnored(m.userId)}
                    />
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {m.name}
                    </span>
                    <span className="text-zinc-400">ignore</span>
                  </label>
                  <ConflictList conflicts={m.conflicts} />
                </div>
              ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ConflictList({
  conflicts,
}: {
  conflicts: SidebarCastMember["conflicts"];
}) {
  if (conflicts.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5 pl-1 text-zinc-500">
      {conflicts.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-1">
          <span>{timeFormatter.format(new Date(c.startDateTime))}</span>
          {c.title && (
            <span className="text-zinc-600 dark:text-zinc-300">{c.title}</span>
          )}
          <ConflictStatusBadge status={c.status} />
        </li>
      ))}
    </ul>
  );
}
