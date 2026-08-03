"use client";

import { useOptimistic, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  setConflictStatus,
  setWeekConflictStatus,
} from "@/lib/actions/conflicts";

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
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});
const dayFormatter = new Intl.DateTimeFormat("en-US", {
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
  prevWeek,
  nextWeek,
  awayThisWeek,
}: {
  people: ReviewPerson[];
  weekLabel: string;
  weekOfIso: string;
  prevWeek: string;
  nextWeek: string;
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Conflict Review
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Go person by person and say whether each conflict is excused. This is
          the step before you build the schedule.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <Link
            href={`/admin/conflicts?week=${prevWeek}`}
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            ←
          </Link>
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            Week of {weekLabel}
          </span>
          <Link
            href={`/admin/conflicts?week=${nextWeek}`}
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            →
          </Link>
        </div>
        <p className="text-sm">
          {total === 0 ? (
            <span className="text-zinc-500">Nothing logged this week.</span>
          ) : outstanding === 0 ? (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              All {total} reviewed — ready to schedule
            </span>
          ) : (
            <span className="font-medium text-amber-700 dark:text-amber-400">
              {outstanding} of {total} still to review
            </span>
          )}
        </p>
      </div>

      {awayThisWeek.length > 0 && (
        <section className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/50">
          <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-200">
            Away this week ({awayThisWeek.length})
          </h2>
          <p className="mb-2 text-xs text-sky-800/80 dark:text-sky-300/80">
            Out of town, so they&rsquo;re out of scheduling entirely — nothing
            to excuse here, but worth knowing before you build the week.
          </p>
          <ul className="flex flex-col gap-1">
            {awayThisWeek.map((away) => (
              <li
                key={away.id}
                className="flex flex-wrap items-center gap-x-2 text-sm text-sky-900 dark:text-sky-200"
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
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium text-zinc-900 dark:text-zinc-50">
                  {person.name}
                  {todo > 0 && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      {todo} to review
                    </span>
                  )}
                </h2>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-400">Whole week:</span>
                  <button
                    onClick={() => markWeek(person.userId, "EXCUSED")}
                    disabled={isPending}
                    className="rounded-lg border border-emerald-200 px-2.5 py-1 font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950"
                  >
                    Excuse all
                  </button>
                  <button
                    onClick={() => markWeek(person.userId, "UNEXCUSED")}
                    disabled={isPending}
                    className="rounded-lg border border-amber-200 px-2.5 py-1 font-medium text-amber-800 transition-colors hover:bg-amber-50 disabled:opacity-40 dark:border-amber-900 dark:text-amber-400 dark:hover:bg-amber-950"
                  >
                    Unexcuse all
                  </button>
                </div>
              </div>

              <ul className="flex flex-col gap-1.5">
                {person.conflicts.map((conflict) => (
                  <li
                    key={conflict.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60"
                  >
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {conflict.title || "Untitled conflict"}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {timeFormatter.format(new Date(conflict.startDateTime))} –{" "}
                      {timeFormatter.format(new Date(conflict.endDateTime))}
                      {conflict.fromGoogle && " · from their calendar"}
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                      <Choice
                        active={conflict.status === "EXCUSED"}
                        activeClass="bg-emerald-600 text-white"
                        onClick={() =>
                          markOne(person.userId, conflict.id, "EXCUSED")
                        }
                      >
                        Excused
                      </Choice>
                      <Choice
                        active={conflict.status === "UNEXCUSED"}
                        activeClass="bg-amber-600 text-white"
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
          <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
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
      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? activeClass
          : "bg-white text-zinc-500 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}
