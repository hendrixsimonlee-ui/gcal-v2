"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ANY_SPACE } from "@/lib/constants";
import {
  confirmAllDrafts,
  createDraftPractice,
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
import { PracticeEditor } from "@/components/schedule-builder/practice-editor";
import { ConflictStatusBadge } from "@/components/status-badges";
import { APP_TIME_ZONE } from "@/lib/timezone";

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
    date: string | null;
    isAvailable: boolean;
  }[];
}

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const clockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

/** "Thu, Aug 6 · 7:00 PM – 8:30 PM". Both ends of every slot, everywhere.
 *
 * A suggestion you can't see the length of isn't a suggestion you can accept
 * without opening something else first. */
function slotRange(start: Date, end: Date): string {
  return `${timeFormatter.format(start)} – ${clockFormatter.format(end)}`;
}

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
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

  function bump() {
    setRefreshKey((k) => k + 1);
  }

  const relevantSpaces = useMemo(
    () =>
      spaceId === ANY_SPACE ? spaces : spaces.filter((s) => s.id === spaceId),
    [spaces, spaceId],
  );

  const businessHours = useMemo(
    () =>
      relevantSpaces.flatMap((space) =>
        space.availabilities
          .filter((a) => a.dayOfWeek !== null && a.startTime && a.endTime)
          .map((a) => ({
            daysOfWeek: [a.dayOfWeek!],
            startTime: a.startTime!,
            endTime: a.endTime!,
          })),
      ),
    [relevantSpaces],
  );

  /** Availability that lives on a specific date rather than a weekly pattern.
   *
   * FullCalendar's `businessHours` only understands recurring weekly windows,
   * so without this the whole shared-spaces-calendar import — which produces
   * dated windows, one per booking — would be invisible on the grid. The AD
   * would sync a term and see an empty week. */
  const datedAvailability = useMemo(
    () =>
      relevantSpaces.flatMap((space) =>
        space.availabilities
          .filter((a) => a.date && a.isAvailable && a.startTime && a.endTime)
          .map((a) => ({
            spaceName: space.name,
            dateKey: a.date!.slice(0, 10),
            startTime: a.startTime!,
            endTime: a.endTime!,
          })),
      ),
    [relevantSpaces],
  );

  const allDrafts = initialPractices.filter((p) => p.status === "PROPOSED");
  const practicesThisWeek = useMemo(
    () =>
      initialPractices
        .filter((p) => {
          const start = new Date(p.startDateTime);
          return start >= startOfWeek(visibleRange.start) &&
            start <
              new Date(
                startOfWeek(visibleRange.start).getTime() +
                  7 * 24 * 60 * 60 * 1000,
              );
        })
        .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime)),
    [initialPractices, visibleRange.start],
  );

  /** Candidates, cut down to the week the AD is looking at.
   *
   * The engine searches four weeks ahead so a dance with a genuinely full
   * week still gets an answer. But the AD works one week at a time, and a
   * ranked list whose top suggestion was eleven days away read as "there is
   * nothing this week" when there usually was. Anything further out is kept
   * behind a count, not thrown away. */
  const weekStart = useMemo(
    () => startOfWeek(visibleRange.start),
    [visibleRange.start],
  );
  const weekEnd = useMemo(
    () => new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    [weekStart],
  );
  const candidatesThisWeek = useMemo(
    () =>
      candidates.filter(
        (c) => c.startDateTime >= weekStart && c.startDateTime < weekEnd,
      ),
    [candidates, weekStart, weekEnd],
  );
  const laterCandidateCount = candidates.length - candidatesThisWeek.length;

  /** The windows any room in view is actually open, as instants.
   *
   * Used to hide conflicts nobody could have been scheduled into anyway: a
   * 9am lecture is irrelevant when every room the team has is an evening
   * booking, and listing it buried the two conflicts that did matter. */
  const openWindows = useMemo(() => {
    const windows: { start: number; end: number }[] = [];
    const toMinutes = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };

    for (const a of datedAvailability) {
      const day = new Date(`${a.dateKey}T00:00:00`);
      windows.push({
        start: day.getTime() + toMinutes(a.startTime) * 60000,
        end: day.getTime() + toMinutes(a.endTime) * 60000,
      });
    }
    for (
      let day = new Date(weekStart);
      day < weekEnd;
      day = new Date(day.getTime() + 24 * 60 * 60 * 1000)
    ) {
      for (const b of businessHours) {
        if (!b.daysOfWeek.includes(day.getDay())) continue;
        const midnight = new Date(day);
        midnight.setHours(0, 0, 0, 0);
        windows.push({
          start: midnight.getTime() + toMinutes(b.startTime) * 60000,
          end: midnight.getTime() + toMinutes(b.endTime) * 60000,
        });
      }
    }
    return windows;
  }, [datedAvailability, businessHours, weekStart, weekEnd]);

  const choreographers = useMemo(
    () => sidebar.filter((m) => m.role === "CHOREOGRAPHER"),
    [sidebar],
  );
  const dancers = useMemo(
    () => sidebar.filter((m) => m.role === "DANCER"),
    [sidebar],
  );

  const overlapsOpenTime = useMemo(() => {
    return (startIso: string | Date, endIso: string | Date) => {
      if (openWindows.length === 0) return true;
      const s = new Date(startIso).getTime();
      const e = new Date(endIso).getTime();
      return openWindows.some((w) => s < w.end && e > w.start);
    };
  }, [openWindows]);

  const visibleConflicts = useMemo(
    () => (member: SidebarCastMember) =>
      member.conflicts.filter((c) =>
        overlapsOpenTime(c.startDateTime, c.endDateTime),
      ),
    [overlapsOpenTime],
  );

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
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-soft">Dance</label>
          <select
            value={danceId}
            onChange={(e) => selectDance(e.target.value)}
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
          >
            {dances.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-soft">Space</label>
          <select
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
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
          <label className="text-xs font-medium text-ink-soft">
            Duration (minutes)
          </label>
          <input
            type="number"
            min={15}
            step={15}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value) || 90)}
            className="w-28 rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
          />
        </div>
        {isPending && (
          <span className="pb-2 text-xs text-ink-faint">Saving…</span>
        )}
      </div>

      {/* Publishing is a deliberate, separate step: the AD lays out the whole
          term as drafts, then tells everyone once. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        <div className="text-sm">
          {allDrafts.length === 0 ? (
            <span className="text-ink-soft">
              No unpublished drafts. Nothing is waiting to be announced.
            </span>
          ) : (
            <>
              <span className="font-medium text-ink">
                {allDrafts.length} draft practice
                {allDrafts.length === 1 ? "" : "s"} not yet published
              </span>
              <span className="ml-2 text-ink-soft">
                — drafts hold their room but nobody has been told about them
                yet.
              </span>
            </>
          )}
          {publishResult && (
            <span className="ml-2 font-medium text-good">
              {publishResult}
            </span>
          )}
        </div>
        <button
          onClick={publishAll}
          disabled={isPending || allDrafts.length === 0}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-45"
        >
          {isPending ? "Publishing…" : "Publish schedule"}
        </button>
      </div>

      <WeekTracker
        weekOf={weekStart}
        refreshKey={refreshKey}
        selectedDanceId={danceId}
        onPickDance={(id) => {
          selectDance(id);
          setEditingId(null);
          setHint(
            `${dances.find((d) => d.id === id)?.name ?? "That dance"} is loaded — the slots and cast below are now for it.`,
          );
        }}
      />

      {hint && (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
          {hint}
        </p>
      )}

      {editingId && (
        <PracticeEditor
          practiceId={editingId}
          onClose={() => setEditingId(null)}
          onChanged={bump}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_300px]">
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Best times this week</h2>
          <p className="mb-2 mt-0.5 text-xs text-ink-soft">
            Ranked by how much of the cast can make it. Only slots in the week
            you&rsquo;re looking at.
          </p>
          {candidatesThisWeek.length === 0 && (
            <p className="text-xs text-ink-soft">
              {laterCandidateCount > 0
                ? `Nothing fits this week. There ${ laterCandidateCount === 1 ? "is 1 option" : `are ${laterCandidateCount} options`
                  } in the following weeks — use the calendar arrows to look ahead.`
                : "No open slots at all for this room and duration. Check the room's hours, or shorten the practice."}
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {candidatesThisWeek.map((c, i) => {
              const affected = new Set(
                c.conflictedCastMembers.map((m) => m.userId),
              ).size;
              return (
                <li
                  key={c.startDateTime.toISOString()}
                  className="rounded-lg border border-line p-2 text-xs"
                >
                  <div className="font-medium tabular-nums text-ink">
                    #{i + 1} {slotRange(c.startDateTime, c.endDateTime)}
                  </div>
                  <div className="text-ink-soft">{c.spaceName}</div>
                  <div className={affected > 0 ? "text-warn" : "text-good"}>
                    {affected > 0
                      ? `${affected} can't make it`
                      : "Everyone can make it"}
                  </div>
                  <button
                    onClick={() => applyCandidate(c)}
                    className="mt-1 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs font-medium text-ink transition-colors hover:border-accent hover:text-accent"
                  >
                    Use this slot
                  </button>
                </li>
              );
            })}
          </ul>
          {candidatesThisWeek.length > 0 && laterCandidateCount > 0 && (
            <p className="mt-2 text-xs text-ink-faint">
              {laterCandidateCount} more in later weeks.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-line bg-surface p-2">
          <ScheduleCalendar
            practices={initialPractices}
            candidates={candidatesThisWeek}
            businessHours={businessHours}
            datedAvailability={datedAvailability}
            legendSpaceCount={relevantSpaces.length}
            onSelectRange={handleSelectRange}
            onEventMove={handleEventMove}
            onEventClick={(id) => {
              setHint(null);
              setEditingId(id);
            }}
            onDatesSet={(start, end) => setVisibleRange({ start, end })}
          />
          {practicesThisWeek.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
              {practicesThisWeek.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-2 py-1.5 text-xs"
                >
                  <span className="font-medium text-ink">{p.danceName}</span>
                  <span className="tabular-nums text-ink-soft">
                    {slotRange(new Date(p.startDateTime), new Date(p.endDateTime))}
                  </span>
                  <span className="text-ink-soft">
                    {p.spaceName ?? "no room yet"}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ p.status === "PROPOSED"
                        ? "bg-info-soft text-info"
                        : "bg-good-soft text-good"
                    }`}
                  >
                    {p.status === "PROPOSED" ? "Draft" : "Published"}
                  </span>
                  <button
                    onClick={() => {
                      setHint(null);
                      setEditingId(p.id);
                    }}
                    className="ml-auto font-medium text-accent hover:underline"
                  >
                    Edit
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              Cast &amp; conflicts this week
            </h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              Only conflicts that land on hours a room is actually open — the
              rest can&rsquo;t affect this dance&rsquo;s options.
            </p>
          </div>

          {choreographers.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Choreographers · must be there
              </p>
              <div className="flex flex-col gap-2.5">
                {choreographers.map((m) => (
                  <div key={m.userId} className="text-xs">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={m.excusedThisWeek}
                        onChange={() =>
                          toggleChoreographerExcuse(m.userId, m.excusedThisWeek)
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium text-ink">{m.name}</span>
                        <span className="block text-ink-faint">
                          {m.excusedThisWeek
                            ? "Excused this week — the app will schedule without them"
                            : "Tick to excuse them this week only"}
                        </span>
                      </span>
                    </label>
                    <ConflictList
                      conflicts={visibleConflicts(m)}
                      hidden={m.conflicts.length - visibleConflicts(m).length}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {dancers.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Dancers
              </p>
              <p className="mb-1.5 text-xs text-ink-soft">
                Ticking someone leaves them out of this week&rsquo;s
                scheduling: their conflicts stop counting against every slot.
                It changes nothing in their record.
              </p>
              <div className="flex flex-col gap-2.5">
                {dancers.map((m) => {
                  const shown = visibleConflicts(m);
                  return (
                    <div key={m.userId} className="text-xs">
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={ignoredUserIds.has(m.userId)}
                          onChange={() => toggleIgnored(m.userId)}
                          className="mt-0.5"
                        />
                        <span
                          className={
                            ignoredUserIds.has(m.userId)
                              ? "font-medium text-ink-faint line-through"
                              : "font-medium text-ink"
                          }
                        >
                          {m.name}
                        </span>
                        {shown.length > 0 && (
                          <span className="ml-auto text-warn">
                            {shown.length}
                          </span>
                        )}
                      </label>
                      <ConflictList
                        conflicts={shown}
                        hidden={m.conflicts.length - shown.length}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {sidebar.length === 0 && (
            <p className="text-xs text-ink-soft">
              Nobody is cast in this dance yet. Add the cast on the Dances
              screen.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function ConflictList({
  conflicts,
  hidden = 0,
}: {
  conflicts: SidebarCastMember["conflicts"];
  /** Conflicts left out because they don't touch any open room time. Named
   * rather than silently dropped, so the panel is never quietly lying. */
  hidden?: number;
}) {
  if (conflicts.length === 0) {
    return hidden > 0 ? (
      <p className="mt-0.5 pl-6 text-ink-faint">
        Free whenever a room is open ({hidden} other{" "}
        {hidden === 1 ? "conflict" : "conflicts"} this week)
      </p>
    ) : null;
  }
  return (
    <>
      <ul className="mt-1 flex flex-col gap-0.5 pl-6 text-ink-soft">
        {conflicts.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-1">
            <span className="tabular-nums">
              {slotRange(new Date(c.startDateTime), new Date(c.endDateTime))}
            </span>
            {c.title && <span className="text-ink-soft">{c.title}</span>}
            <ConflictStatusBadge status={c.status} />
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="pl-6 text-ink-faint">
          + {hidden} outside any room&rsquo;s hours
        </p>
      )}
    </>
  );
}
