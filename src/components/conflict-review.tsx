"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setConflictStatus,
  setWeekConflictStatus,
} from "@/lib/actions/conflicts";
import { SubmissionTracker } from "@/components/submission-tracker";
import { WeekNav } from "@/components/week-nav";
import { APP_TIME_ZONE } from "@/lib/timezone";

type Status = "NOT_REVIEWED" | "EXCUSED" | "UNEXCUSED";

interface ReviewConflict {
  id: string;
  title: string | null;
  startDateTime: string;
  endDateTime: string;
  status: Status;
  fromGoogle: boolean;
}

interface ReviewPerson {
  userId: string;
  name: string;
  conflicts: ReviewConflict[];
}

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});
const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
});

interface AwayWindow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  reason: string | null;
}

export function ConflictReview({
  people,
  weekLabel,
  weekOfIso,
  weekStartKey,
  todayKey,
  awayThisWeek,
}: {
  people: ReviewPerson[];
  weekLabel: string;
  weekOfIso: string;
  weekStartKey: string;
  todayKey: string;
  awayThisWeek: AwayWindow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Marking a conflict shouldn't feel like submitting a form — the badge
  // flips the moment you tap and the write happens behind it.
  const [optimistic, applyOptimistic] = useOptimistic(
    people,
    (
      current: ReviewPerson[],
      change: { userId: string; conflictId?: string; status: Status },
    ) =>
      current.map((person) =>
        person.userId !== change.userId
          ? person
          : {
              ...person,
              conflicts: person.conflicts.map((c) =>
                change.conflictId && c.id !== change.conflictId
                  ? c
                  : { ...c, status: change.status },
              ),
            },
      ),
  );

  function markOne(userId: string, conflictId: string, status: Status) {
    startTransition(async () => {
      applyOptimistic({ userId, conflictId, status });
      await setConflictStatus(conflictId, status);
      router.refresh();
    });
  }

  function markWeek(userId: string, status: "EXCUSED" | "UNEXCUSED") {
    startTransition(async () => {
      applyOptimistic({ userId, status });
      await setWeekConflictStatus(userId, weekOfIso, status);
      router.refresh();
    });
  }

  const outstanding = optimistic.reduce(
    (sum, p) => sum + p.conflicts.filter((c) => c.status === "NOT_REVIEWED").length,
    0,
  );
  const total = optimistic.reduce((sum, p) => sum + p.conflicts.length, 0);

  return (
    <div className="flex flex-col gap-5">
      <WeekNav
        basePath="/admin/conflicts"
        weekStartKey={weekStartKey}
        weekLabel={weekLabel}
        todayKey={todayKey}
      >
        {total === 0 ? (
          <span className="text-ink-soft">Nothing logged this week.</span>
        ) : outstanding === 0 ? (
          <span className="font-medium text-good">
            All {total} reviewed — ready to schedule
          </span>
        ) : (
          <span className="font-medium text-warn">
            {outstanding} of {total} still to review
          </span>
        )}
      </WeekNav>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Conflict Review
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Two jobs, in order: check everyone&rsquo;s conflicts are actually in,
          then go person by person and say whether each one is excused. Both
          come before building the schedule.
        </p>
      </div>

      <SubmissionTracker weekOfIso={weekOfIso} weekLabel={weekLabel} />


      {awayThisWeek.length > 0 && (
        <section className="rounded-xl border border-info/35 bg-info-soft p-4">
          <h2 className="text-sm font-semibold text-info">
            Away this week ({awayThisWeek.length})
          </h2>
          <p className="mb-2 text-xs text-info /80">
            Out of town, so they&rsquo;re out of scheduling entirely — nothing
            to excuse here, but worth knowing before you build the week.
          </p>
          <ul className="flex flex-col gap-1">
            {awayThisWeek.map((away) => (
              <li
                key={away.id}
                className="flex flex-wrap items-center gap-x-2 text-sm text-info"
              >
                <span className="font-medium">{away.name}</span>
                <span className="text-xs">
                  {dayFormatter.format(new Date(away.startDate))} –{" "}
                  {dayFormatter.format(new Date(away.endDate))}
                </span>
                {away.reason && (
                  <span className="text-xs opacity-70">{away.reason}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-3">
        {optimistic.map((person) => {
          const todo = person.conflicts.filter(
            (c) => c.status === "NOT_REVIEWED",
          ).length;
          return (
            <section
              key={person.userId}
              className="rounded-xl border border-line bg-surface p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium text-ink">
                  {person.name}
                  {todo > 0 && (
                    <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
                      {todo} to review
                    </span>
                  )}
                </h2>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-ink-faint">Whole week:</span>
                  <button
                    onClick={() => markWeek(person.userId, "EXCUSED")}
                    disabled={isPending}
                    className="rounded-lg border border-good/35 px-2.5 py-1 font-medium text-good transition-colors hover:bg-good-soft disabled:opacity-45 dark:hover:bg-surface-2"
                  >
                    Excuse all
                  </button>
                  <button
                    onClick={() => markWeek(person.userId, "UNEXCUSED")}
                    disabled={isPending}
                    className="rounded-lg border border-warn/35 px-2.5 py-1 font-medium text-warn transition-colors hover:bg-warn-soft disabled:opacity-45 dark:hover:bg-surface-2"
                  >
                    Unexcuse all
                  </button>
                </div>
              </div>

              <ul className="flex flex-col gap-1.5">
                {person.conflicts.map((conflict) => (
                  <li
                    key={conflict.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-2 px-3 py-2 bg-surface-3/60"
                  >
                    <span className="font-medium text-ink">
                      {conflict.title || "Untitled conflict"}
                    </span>
                    <span className="text-xs text-ink-soft">
                      {timeFormatter.format(new Date(conflict.startDateTime))} –{" "}
                      {timeFormatter.format(new Date(conflict.endDateTime))}
                      {conflict.fromGoogle && " · from their calendar"}
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                      <Choice
                        active={conflict.status === "EXCUSED"}
                        activeClass="bg-good text-surface"
                        onClick={() =>
                          markOne(person.userId, conflict.id, "EXCUSED")
                        }
                      >
                        Excused
                      </Choice>
                      <Choice
                        active={conflict.status === "UNEXCUSED"}
                        activeClass="bg-warn text-surface"
                        onClick={() =>
                          markOne(person.userId, conflict.id, "UNEXCUSED")
                        }
                      >
                        Unexcused
                      </Choice>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        {optimistic.length === 0 && (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-soft">
            Nobody logged a conflict for this week.
          </p>
        )}
      </div>
    </div>
  );
}

function Choice({
  active,
  activeClass,
  onClick,
  children,
}: {
  active: boolean;
  activeClass: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${ active
          ? activeClass
          : "bg-surface text-ink-soft ring-1 ring-line hover:bg-surface-2  dark:ring-line "
      }`}
    >
      {children}
    </button>
  );
}
