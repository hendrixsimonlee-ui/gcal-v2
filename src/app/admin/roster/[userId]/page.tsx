import Link from "next/link";
import { notFound } from "next/navigation";
import { getPersonDossier } from "@/lib/person-data";
import { PersonAttendanceRow } from "@/components/person-attendance-row";
import { ConflictStatusBadge } from "@/components/status-badges";
import { APP_TIME_ZONE } from "@/lib/timezone";
import { ConflictCalendarSync } from "@/components/conflict-calendar-sync";
import { startOfWeek } from "@/lib/dates";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
});
const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** One person, everything the app knows about them.
 *
 * Built for the conversation that starts "I was definitely there" — their
 * whole record on one page, with the override in reach on every row. */
export default async function PersonPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const person = await getPersonDossier(userId);
  if (!person) notFound();

  const { totals } = person;
  const upcomingConflicts = person.conflicts.filter(
    (c) => c.endDateTime >= new Date(),
  );
  const pastConflicts = person.conflicts.filter(
    (c) => c.endDateTime < new Date(),
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/admin/roster"
          className="text-sm text-ink-soft hover:underline"
        >
          ← Roster
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          {person.name}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
          <span>{person.email}</span>
          {person.isAdmin && (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-700 dark:bg-purple-950 dark:text-purple-300">
              Admin
            </span>
          )}
          <span>
            {person.conflictCalendarName
              ? `syncing conflicts from ${person.conflictCalendarName}`
              : "hasn't linked a conflict calendar yet"}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Attendance" value={`${totals.attendanceRate}%`} />
        <Stat label="Recorded" value={String(totals.recorded)} />
        <Stat
          label="Unexcused"
          value={String(totals.unexcused)}
          tone={totals.unexcused > 0 ? "bad" : undefined}
        />
        <Stat label="Excused" value={String(totals.excused)} />
        <Stat
          label="Minutes late"
          value={String(totals.minutesLate)}
          tone={totals.minutesLate > 0 ? "warn" : undefined}
        />
      </div>

      {person.dances.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">
            Dances
          </h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {person.dances.map((dance) => (
              <li
                key={`${dance.danceId}-${dance.role}`}
                className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 bg-surface-3/60"
              >
                <span className="text-ink">
                  {dance.danceName}
                </span>
                <span className="text-xs text-ink-soft">
                  {dance.role === "CHOREOGRAPHER" ? "choreographer" : "dancer"}
                </span>
                {dance.archived && (
                  <span className="text-[10px] uppercase text-ink-faint">
                    archived
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {person.lateByMonth.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">
            Minutes late, month by month
          </h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {person.lateByMonth.map((month) => (
              <li
                key={month.label}
                className="rounded-lg bg-warn-soft px-3 py-1.5 text-warn"
              >
                <span className="font-medium">{month.minutes} min</span>{" "}
                <span className="text-xs opacity-80">{month.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink">
          Every practice
        </h2>
        <p className="mb-3 text-xs text-ink-soft">
          Newest first, including finished pieces. Change any answer right
          here — it saves straight away and shows as edited.
        </p>
        {person.practices.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {person.practices.map((practice) => (
              <PersonAttendanceRow
                key={practice.practiceId}
                practiceId={practice.practiceId}
                userId={person.userId}
                danceName={practice.danceName}
                danceArchived={practice.danceArchived}
                spaceName={practice.spaceName}
                startDateTime={practice.startDateTime.toISOString()}
                status={practice.status}
                minutesLate={practice.minutesLate}
                checkedInAt={practice.checkedInAt?.toISOString() ?? null}
                isOverride={practice.isOverride}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">
          Conflicts
        </h2>

        {/* Run the sync for them. Saves chasing a dancer to go and press a
            button when their calendar has changed and the schedule depends
            on it. */}
        <div className="mb-3">
          <ConflictCalendarSync
            linkedCalendarName={person.conflictCalendarName}
            weekStartIso={startOfWeek(new Date()).toISOString()}
            onBehalfOfUserId={person.userId}
            onBehalfOfName={person.name}
          />
        </div>

        {person.conflicts.length === 0 ? (
          <p className="text-sm text-ink-soft">None logged.</p>
        ) : (
          <>
            <ConflictList title="Coming up" rows={upcomingConflicts} />
            <ConflictList title="Past" rows={pastConflicts} collapsed />
          </>
        )}

        {person.away.length > 0 && (
          <>
            <h3 className="mb-1 mt-4 text-xs font-medium uppercase text-ink-faint">
              Out of town
            </h3>
            <ul className="flex flex-col gap-1 text-sm">
              {person.away.map((away) => (
                <li
                  key={away.id}
                  className="rounded-lg bg-info-soft px-3 py-1.5 text-info"
                >
                  {dayFormatter.format(away.startDate)} –{" "}
                  {dayFormatter.format(away.endDate)}
                  {away.reason && (
                    <span className="ml-2 text-xs opacity-70">{away.reason}</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {person.notes.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">
            Notes about them
          </h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {person.notes.map((note) => (
              <li
                key={note.id}
                className="flex flex-wrap items-center gap-x-2 rounded-lg bg-surface-2 px-3 py-2 bg-surface-3/60"
              >
                <span className="text-ink">
                  {note.body}
                </span>
                <span className="text-xs text-ink-faint">
                  — {note.authorName}, {note.danceName}{" "}
                  {dateFormatter.format(note.startDateTime)}
                </span>
                <Link
                  href={`/attendance/${note.practiceId}`}
                  className="ml-auto text-xs font-medium text-accent hover:underline"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ConflictList({
  title,
  rows,
  collapsed,
}: {
  title: string;
  rows: {
    id: string;
    title: string | null;
    startDateTime: Date;
    endDateTime: Date;
    status: "NOT_REVIEWED" | "EXCUSED" | "UNEXCUSED";
    fromGoogle: boolean;
  }[];
  collapsed?: boolean;
}) {
  if (rows.length === 0) return null;

  const list = (
    <ul className="flex flex-col gap-1 text-sm">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex flex-wrap items-center gap-x-2 rounded-lg bg-surface-2 px-3 py-1.5 bg-surface-3/60"
        >
          <span className="text-ink">
            {row.title || "Untitled"}
          </span>
          <span className="text-xs text-ink-soft">
            {dateFormatter.format(row.startDateTime)}
            {row.fromGoogle && " · from their calendar"}
          </span>
          <span className="ml-auto">
            <ConflictStatusBadge status={row.status} />
          </span>
        </li>
      ))}
    </ul>
  );

  if (collapsed) {
    return (
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium uppercase text-ink-faint">
          {title} ({rows.length})
        </summary>
        <div className="mt-1">{list}</div>
      </details>
    );
  }

  return (
    <>
      <h3 className="mb-1 text-xs font-medium uppercase text-ink-faint">
        {title}
      </h3>
      {list}
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "bad" | "warn";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2">
      <p className="text-xs text-ink-soft">{label}</p>
      <p
        className={`text-lg font-semibold ${ tone === "bad"
            ? "text-bad"
            : tone === "warn"
              ? "text-warn"
              : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
