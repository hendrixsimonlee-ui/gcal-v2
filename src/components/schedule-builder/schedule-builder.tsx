"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ANY_SPACE } from "@/lib/constants";
import {
  confirmAllDrafts,
  createDraftPractice,
  getCandidateSlots,
  getSchedulingSidebarData,
  setWeeklyExclusion,
  updatePracticeTime,
  type SidebarCastMember,
} from "@/lib/actions/schedule";
import type { CandidateSlot } from "@/lib/scheduling";
import { formatWeekLabel, startOfWeek, toDateParam } from "@/lib/dates";
import { WeekNav } from "@/components/week-nav";
import {
  ScheduleCalendar,
  type PracticeEvent,
} from "@/components/schedule-builder/schedule-calendar";
import { WeekTracker } from "@/components/schedule-builder/week-tracker";
import { PracticeEditor } from "@/components/schedule-builder/practice-editor";
import { BuildWeek } from "@/components/schedule-builder/build-week";
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
  /** Every block this room is ours, straight off the spaces calendar. There
   * is no weekly pattern any more — a room is bookable only when somebody
   * actually booked it. */
  bookings: { id: string; dateKey: string; startTime: string; endTime: string }[];
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

type ConflictedPerson = {
  name: string;
  isChoreographer: boolean;
  reasons: string[];
};

/** What to show beside a name: what they have on, and when.
 *
 * Returns null where there is nothing worth saying — a clash with another
 * dance already reads as "double-booked", and a historical nudge is a hint
 * about a weekday rather than a thing on anybody's calendar. */
function describeNote(note: {
  reason: string;
  title?: string | null;
  startIso?: string;
  endIso?: string;
}): string | null {
  if (note.reason === "other-practice") return "in another dance then";
  if (note.reason === "historically-absent") return null;

  const when =
    note.startIso && note.endIso
      ? `${clockFormatter.format(new Date(note.startIso))}–${clockFormatter.format(new Date(note.endIso))}`
      : null;
  const what = note.title?.trim() || "busy";
  return when ? `${what}, ${when}` : what;
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
  const [candidates, setCandidates] = useState<CandidateSlot[]>([]);
  const [sidebar, setSidebar] = useState<SidebarCastMember[]>([]);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  // Candidates are client state, so router.refresh() alone won't recompute
  // them. Every mutation bumps this so the list reflects the new practices
  // (a fresh draft holds its room, so it must drop out of the suggestions).
  const [refreshKey, setRefreshKey] = useState(0);
  // What the date bar has asked the grid to show. The grid still owns the
  // visible range — this is only the request.
  const [gotoDateKey, setGotoDateKey] = useState<string | undefined>();
  const [visibleRange, setVisibleRange] = useState<{ start: Date; end: Date }>(
    () => {
      const start = startOfWeek(new Date());
      const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
      return { start, end };
    },
  );

  /** The week the grid is showing, taken from the middle of its range.
   *
   * FullCalendar reports its visible range as local-midnight boundaries. On a
   * device east of Eastern — a phone set to UTC, someone abroad — local
   * midnight on Monday is still Sunday evening here, so taking the week from
   * `start` landed a whole week early: the tracker said "Jul 27" under a grid
   * showing "Aug 3", and every count and publish button under it was for the
   * wrong week. The midpoint is Thursday-ish and can't be dragged out of the
   * week by a few hours in either direction. */
  const weekStart = useMemo(
    () =>
      startOfWeek(
        new Date(
          (visibleRange.start.getTime() + visibleRange.end.getTime()) / 2,
        ),
      ),
    [visibleRange.start, visibleRange.end],
  );
  const weekEnd = useMemo(
    () => new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    [weekStart],
  );

  useEffect(() => {
    if (!danceId || !spaceId) return;
    let cancelled = false;
    // Scoped to the week on screen.
    //
    // This used to ask for the general suggestions — the best eight anywhere
    // in the next four weeks — and then filter them to the visible week. Slots
    // that existed this week but didn't make that term-wide top eight simply
    // vanished, and the panel said "nothing fits this week" when something
    // perfectly workable did. Asking for the week directly means the list is
    // always this week's best options, however good or bad they are.
    getCandidateSlots(danceId, spaceId, durationMinutes, [], {
      startIso: weekStart.toISOString(),
      endIso: weekEnd.toISOString(),
    }).then((result) => {
      if (!cancelled) setCandidates(result);
    });
    return () => {
      cancelled = true;
    };
  }, [danceId, spaceId, durationMinutes, refreshKey, weekStart, weekEnd]);

  useEffect(() => {
    if (!danceId) return;
    let cancelled = false;
    const weekOf = weekStart.toISOString();
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
  }, [danceId, visibleRange, weekStart]);

  /** Switching dances also pulls in that piece's usual practice length, so
   * the AD isn't retyping the duration for every dance in the tracker. */
  function selectDance(nextDanceId: string) {
    setDanceId(nextDanceId);
    const dance = dances.find((d) => d.id === nextDanceId);
    if (dance) setDurationMinutes(dance.defaultDurationMinutes);
  }

  /** Ticking anyone — dancer or choreographer — writes a real exclusion with
   * a reason, rather than the old browser-only tick that vanished on refresh
   * and left no trace of who was left out or why. */
  function toggleExclusion(userId: string, currentlyExcluded: boolean) {
    const weekOf = weekStart.toISOString();
    startTransition(async () => {
      await setWeeklyExclusion(danceId, userId, weekOf, !currentlyExcluded);
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

  /** Every bookable block in view, as the grid wants it.
   *
   * FullCalendar's `businessHours` only understands recurring weekly windows,
   * which is why it used to be here at all. With rooms coming purely from
   * dated calendar events there is no weekly pattern left to express, so
   * these background bands are the whole availability picture. */
  const datedAvailability = useMemo(
    () =>
      relevantSpaces.flatMap((space) =>
        space.bookings.map((b) => ({
          spaceName: space.name,
          dateKey: b.dateKey,
          startTime: b.startTime,
          endTime: b.endTime,
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
          return start >= weekStart && start < weekEnd;
        })
        .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime)),
    [initialPractices, weekStart, weekEnd],
  );

  /** Candidates, cut down to the week the AD is looking at.
   *
   * The engine searches four weeks ahead so a dance with a genuinely full
   * week still gets an answer. But the AD works one week at a time, and a
   * ranked list whose top suggestion was eleven days away read as "there is
   * nothing this week" when there usually was. Anything further out is kept
   * behind a count, not thrown away. */
  const candidatesThisWeek = useMemo(
    () =>
      candidates.filter(
        (c) => c.startDateTime >= weekStart && c.startDateTime < weekEnd,
      ),
    [candidates, weekStart, weekEnd],
  );

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
    return windows;
  }, [datedAvailability]);

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
      {/* One toolbar, not three stacked cards.
          Dance / Space / Duration, the draft count and Publish used to be
          three separate bordered blocks running down the page, which pushed
          the calendar — the thing this screen is for — below the fold. */}
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
        {/* Dances as chips rather than a dropdown. Switching between pieces is
            the single most repeated action here; it shouldn't cost two clicks
            and a menu, and which dance is loaded should be visible without
            opening anything. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {dances.map((d) => (
            <button
              key={d.id}
              onClick={() => {
                selectDance(d.id);
                setEditingId(null);
                setHint(null);
              }}
              aria-pressed={d.id === danceId}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${ d.id === danceId
                  ? "bg-accent text-on-accent"
                  : "border border-line-strong text-ink-soft hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-soft">
            Room
            <select
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
              className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-sm"
            >
              <option value={ANY_SPACE}>Any room</option>
              {spaces.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ink-soft">
            Minutes
            <input
              type="number"
              min={15}
              step={15}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value) || 90)}
              className="w-20 rounded-lg border border-line-strong bg-surface px-2 py-1 text-sm tabular-nums"
            />
          </label>

          <span className="text-xs text-ink-soft">
            {allDrafts.length === 0
              ? "Nothing waiting to be announced."
              : `${allDrafts.length} draft${allDrafts.length === 1 ? "" : "s"} across all weeks — nobody has been told.`}
          </span>
          {publishResult && (
            <span className="text-xs font-medium text-good">{publishResult}</span>
          )}
          {isPending && <span className="text-xs text-ink-faint">Saving…</span>}

          <button
            onClick={publishAll}
            disabled={isPending || allDrafts.length === 0}
            className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            Publish everything
          </button>
        </div>

        {/* Built for the week on screen, not for today's week.
            This used to be rendered on the server and passed in, so it was
            pinned to whatever week the page happened to load on — pressing it
            after navigating two weeks ahead still built the current week.
            Reading the same weekStart the rest of the screen uses means it
            follows the calendar, forwards and backwards alike. */}
        <div className="border-t border-line pt-2">
          <BuildWeek
            weekOfIso={weekStart.toISOString()}
            weekLabel={formatWeekLabel(weekStart)}
            onApplied={bump}
          />
        </div>
      </div>

      <WeekNav
        weekStartKey={toDateParam(weekStart)}
        weekLabel={formatWeekLabel(weekStart)}
        todayKey={toDateParam(new Date())}
        onNavigate={setGotoDateKey}
      />

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
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent-ink">
          {hint}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
        <section className="rounded-lg border border-line bg-surface p-2">
          <ScheduleCalendar
            practices={initialPractices}
            candidates={candidatesThisWeek}
            datedAvailability={datedAvailability}
            legendSpaceCount={relevantSpaces.length}
            onSelectRange={handleSelectRange}
            onEventMove={handleEventMove}
            onEventClick={(id) => {
              setHint(null);
              setEditingId(id);
            }}
            gotoDateKey={gotoDateKey}
            onDatesSet={(start, end) => setVisibleRange({ start, end })}
          />

          {/* The editor sits directly under the grid, not above it.
              Clicking a practice on the calendar used to open the panel above,
              which pushed the calendar down the page — so the AD had to scroll
              back up to see the slot they were editing, every time. */}
          {editingId && (
            <div className="mt-3">
              <PracticeEditor
                practiceId={editingId}
                onClose={() => setEditingId(null)}
                onChanged={bump}
              />
            </div>
          )}

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
                    className="ml-auto font-medium text-accent-ink hover:underline"
                  >
                    Edit
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Right rail: everything that supports the grid, stacked and
            narrow so the calendar keeps the width. */}
        <div className="flex min-w-0 flex-col gap-3">
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Best times this week</h2>
          <p className="mb-2 mt-0.5 text-xs text-ink-soft">
            Ranked by how much of the cast can make it. Only slots in the week
            you&rsquo;re looking at.
          </p>
          {candidatesThisWeek.length === 0 && (
            <p className="text-xs text-ink-soft">
              No room is open for {durationMinutes} minutes anywhere this week.
              Every slot the cast could struggle with is still listed above —
              an empty list here means there is nowhere to put a practice at
              all, not that nobody can come. Check the spaces calendar for this
              week, or shorten the practice.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {candidatesThisWeek.map((c, i) => {
              // One line per person, not one per conflict: somebody with two
              // overlapping commitments is still one person who can't come.
              const byPerson = new Map<string, ConflictedPerson>();
              for (const note of c.conflictedCastMembers) {
                const entry = byPerson.get(note.userId) ?? {
                  name: note.name,
                  isChoreographer: false,
                  reasons: [] as string[],
                };
                if (note.reason === "choreographer-conflict") {
                  entry.isChoreographer = true;
                }
                const label = describeNote(note);
                if (label && !entry.reasons.includes(label)) {
                  entry.reasons.push(label);
                }
                byPerson.set(note.userId, entry);
              }
              const people = Array.from(byPerson.values()).sort(
                (a, b) =>
                  Number(b.isChoreographer) - Number(a.isChoreographer) ||
                  a.name.localeCompare(b.name),
              );

              return (
                <li
                  key={c.startDateTime.toISOString()}
                  className="rounded-lg border border-line p-2 text-xs"
                >
                  <div className="font-medium tabular-nums text-ink">
                    #{i + 1} {slotRange(c.startDateTime, c.endDateTime)}
                  </div>
                  <div className="text-ink-soft">{c.spaceName}</div>

                  {/* Named, not counted. "3 can't make it" doesn't tell the AD
                      whether to move the rehearsal; "Ashley — CHEM lab" does. */}
                  {people.length === 0 ? (
                    <div className="text-good">Everyone can make it</div>
                  ) : (
                    <>
                      <div className="mt-0.5 font-medium text-warn">
                        {people.length}{" "}
                        {people.length === 1 ? "person" : "people"} can&rsquo;t
                        make it
                      </div>
                      <ul className="mt-0.5 flex flex-col gap-0.5">
                        {people.map((p) => (
                          <li key={p.name} className="leading-snug">
                            <span
                              className={
                                p.isChoreographer
                                  ? "font-semibold text-bad"
                                  : "font-medium text-ink"
                              }
                            >
                              {p.name}
                              {p.isChoreographer && " (choreographer)"}
                            </span>
                            {p.reasons.length > 0 && (
                              <span className="text-ink-soft">
                                {" "}
                                — {p.reasons.join("; ")}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {/* Away people don't count against the slot — they miss
                      every slot equally — but the AD still needs the real
                      headcount before deciding to hold the rehearsal. */}
                  {c.awayCastMembers.length > 0 && (
                    <div className="mt-0.5 text-ink-faint">
                      Away all week:{" "}
                      {c.awayCastMembers
                        .map((a) => (a.reason ? `${a.name} (${a.reason})` : a.name))
                        .join(", ")}
                    </div>
                  )}

                  <button
                    onClick={() => applyCandidate(c)}
                    className="mt-1 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs font-medium text-ink transition-colors hover:border-accent hover:text-accent-ink"
                  >
                    Use this slot
                  </button>
                </li>
              );
            })}
          </ul>
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
                        checked={m.excludedThisWeek}
                        onChange={() =>
                          toggleExclusion(m.userId, m.excludedThisWeek)
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium text-ink">{m.name}</span>
                        <span className="block text-ink-faint">
                          {m.excludedThisWeek
                            ? m.exclusionReason ?? "Left out of this week"
                            : "Tick to leave them out of this week only"}
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
                Ticking someone takes them out of this week&rsquo;s scheduling
                entirely — their conflicts stop counting against every slot.
                It <span className="font-medium">is</span> recorded: the reason
                shows on their attendance, and if a practice goes ahead anyway
                they&rsquo;re marked excused, never unexcused.
              </p>
              <div className="flex flex-col gap-2.5">
                {dancers.map((m) => {
                  const shown = visibleConflicts(m);
                  return (
                    <div key={m.userId} className="text-xs">
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={m.excludedThisWeek}
                          onChange={() =>
                            toggleExclusion(m.userId, m.excludedThisWeek)
                          }
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span
                            className={
                              m.excludedThisWeek
                                ? "font-medium text-ink-faint line-through"
                                : "font-medium text-ink"
                            }
                          >
                            {m.name}
                          </span>
                          {m.excludedThisWeek && m.exclusionReason && (
                            <span className="block truncate text-ink-faint">
                              {m.exclusionReason}
                            </span>
                          )}
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
