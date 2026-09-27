import { Fragment } from "react";
import Link from "next/link";
import {
  getAttendanceSettings,
  getAttendanceWeeks,
} from "@/lib/actions/attendance";
import { AttendanceArchive } from "@/components/attendance-archive";
import {
  getChronicAbsenceFlags,
  getDanceTrends,
  getOverallAbsenceFlags,
  getPastPracticesWithAttendance,
  getLatenessBySemester,
  getLatenessRechecks,
  getPersonRollups,
  getRecentUnexcused,
  getWeeklyRollupByDance,
} from "@/lib/attendance-data";
import { getOpenFlags } from "@/lib/actions/attendance-flags";
import { graceMinutes } from "@/lib/attendance-fees";
import { RecheckPanel } from "@/components/attendance/recheck-panel";
import { FlagQueue } from "@/components/attendance/flag-queue";
import { AttendanceBadge } from "@/components/status-badges";
import { formatWeekLabel } from "@/lib/dates";
import { APP_TIME_ZONE } from "@/lib/timezone";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
});

type View = "attention" | "people" | "dances";

/** Three tabs, in the order the AD said they think about this screen: what has
 * gone wrong, then how each person is doing, then how each piece is doing.
 *
 * There were five, split by the shape of the data rather than by any question
 * anybody had — "Lateness by month" and "By dance, week by week" describe
 * tables, not problems. They are all still here, folded inside whichever tab
 * answers the question they belong to. */
const VIEWS: { key: View; label: string }[] = [
  { key: "attention", label: "Needs attention" },
  { key: "people", label: "People" },
  { key: "dances", label: "Dances" },
];

export default async function AdminAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: rawView } = await searchParams;
  const view: View = VIEWS.some((v) => v.key === rawView)
    ? (rawView as View)
    : "attention";

  const settings = await getAttendanceSettings();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Attendance Review</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Flags trip at {settings.chronicAbsenceThreshold}{" "}
          unexcused absences out of a dancer&rsquo;s last{" "}
          {settings.chronicAbsenceWindow} practices —{" "}
          <Link href="/admin/settings" className="underline">
            change that in Settings
          </Link>
          .
        </p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-line">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/admin/attendance?view=${v.key}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${ v.key === view
                ? "border-accent text-accent-ink"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {view === "attention" && (
        <AttentionView
          threshold={settings.chronicAbsenceThreshold}
          windowSize={settings.chronicAbsenceWindow}
        />
      )}
      {view === "people" && (
        <PeopleView
          threshold={settings.chronicAbsenceThreshold}
          windowSize={settings.chronicAbsenceWindow}
        />
      )}
      {view === "dances" && <DancesView />}
    </div>
  );
}

/** What has gone wrong, in the order it needs dealing with.
 *
 * The AD's own priority: unexcused absences first, everything else after. The
 * two things that need a decision — flags raised by choreographers, and
 * lateness the old bug erased — sit above the reading material, because a
 * queue below a table is a queue nobody works through. */
async function AttentionView({
  threshold,
  windowSize,
}: {
  threshold: number;
  windowSize: number;
}) {
  const [rechecks, flags, unexcused, weeks, danceFlags, overallFlags] =
    await Promise.all([
      getLatenessRechecks(graceMinutes()),
      getOpenFlags(),
      getRecentUnexcused(),
      getAttendanceWeeks(),
      getChronicAbsenceFlags(threshold, windowSize),
      getOverallAbsenceFlags(threshold, windowSize),
    ]);

  return (
    <div className="flex flex-col gap-4">
      <RecheckPanel
        items={rechecks.map((r) => ({
          attendanceId: r.attendanceId,
          practiceId: r.practiceId,
          danceName: r.danceName,
          startIso: r.startDateTime.toISOString(),
          name: r.name,
          chargedMinutes: r.chargedMinutes,
          measuredMinutes: r.measuredMinutes,
        }))}
      />

      <FlagQueue flags={flags} />

      <section className="rounded-xl border border-bad/35 bg-bad-soft p-4">
        <h2 className="text-sm font-semibold text-bad">
          Unexcused absences ({unexcused.length})
        </h2>
        <p className="mt-0.5 text-xs text-bad">
          Newest first. Somebody who didn&rsquo;t come and didn&rsquo;t have a
          reason you accepted.
        </p>
        {unexcused.length === 0 ? (
          <p className="mt-2 text-sm text-bad">
            Nobody has missed a rehearsal without an excuse.
          </p>
        ) : (
          <ul className="mt-2.5 flex flex-col gap-1">
            {unexcused.map((row) => (
              <li
                key={`${row.practiceId}-${row.userId}`}
                className="flex flex-wrap items-baseline gap-x-3 rounded-lg bg-surface px-3 py-1.5 text-sm"
              >
                <Link
                  href={`/admin/roster/${row.userId}`}
                  className="font-medium text-ink underline decoration-line-strong decoration-1 underline-offset-2 hover:decoration-accent"
                >
                  {row.name}
                </Link>
                <span className="text-ink-soft">{row.danceName}</span>
                <span className="ml-auto text-xs text-ink-faint">
                  {dateFormatter.format(row.startDateTime)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <FlagCard
          tone="bad"
          title={`Letting down a specific dance (${danceFlags.length})`}
          blurb="Counted within one dance, so a choreographer can see who keeps missing their rehearsals."
          empty="Nobody over the threshold."
          rows={danceFlags.map((f) => ({
            key: `${f.userId}-${f.danceId}`,
            name: f.name,
            middle: f.danceName,
            right: `${f.unexcusedInWindow} of last ${f.windowSize}`,
          }))}
        />
        <FlagCard
          tone="warn"
          title={`Slipping overall (${overallFlags.length})`}
          blurb="Counted across everything they're in — catches someone missing one practice of each piece, which no single dance sees."
          empty="Nobody over the threshold."
          rows={overallFlags.map((f) => ({
            key: f.userId,
            name: f.name,
            middle: f.danceNames.join(", "),
            right: `${f.unexcusedInWindow} of last ${f.windowSize}`,
          }))}
        />
      </div>

      <AttendanceArchive weeks={weeks} />
    </div>
  );
}

function FlagCard({
  tone,
  title,
  blurb,
  empty,
  rows,
}: {
  tone: "bad" | "warn";
  title: string;
  blurb: string;
  empty: string;
  rows: { key: string; name: string; middle: string; right: string }[];
}) {
  const skin =
    tone === "bad"
      ? { box: "border-bad/35 bg-bad-soft", text: "text-bad" }
      : { box: "border-warn/35 bg-warn-soft", text: "text-warn" };
  return (
    <section className={`rounded-xl border p-4 ${skin.box}`}>
      <h2 className={`text-sm font-semibold ${skin.text}`}>{title}</h2>
      <p className={`mb-2 text-xs ${skin.text}`}>{blurb}</p>
      {rows.length === 0 ? (
        <p className={`text-sm ${skin.text}`}>{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <li
              key={r.key}
              className={`flex flex-wrap items-center justify-between gap-2 text-sm ${skin.text}`}
            >
              <span className="font-medium">{r.name}</span>
              <span className="text-xs">{r.middle}</span>
              <span className="text-xs">{r.right}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Everyone, and how they are doing. Lateness folds in underneath rather than
 * living on a tab of its own — it is a column on this question, not a
 * separate one. */
async function PeopleView({
  threshold,
  windowSize,
}: {
  threshold: number;
  windowSize: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ByPersonView threshold={threshold} windowSize={windowSize} />
      <details className="rounded-xl border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          Minutes late, month by month
        </summary>
        <div className="mt-3">
          <LatenessView />
        </div>
      </details>
    </div>
  );
}

/** Each piece, and whether it is holding its people.
 *
 * The question the AD couldn't answer before: a list of who was absent each
 * week doesn't say whether that is a lot, because it never says what normal
 * looks like for that dance. */
async function DancesView() {
  const trends = await getDanceTrends();

  if (trends.length === 0) {
    return <Empty message="No attendance has been marked yet." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">
        Turnout per dance, against that dance&rsquo;s own normal. Excused
        absences are left out — somebody you let off was never expected in the
        room, and counting them would make a good week look thin.
      </p>

      <div className="flex flex-col gap-2">
        {trends.map((trend) => (
          <section
            key={trend.danceId}
            className="rounded-xl border border-line bg-surface p-4"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-semibold text-ink">{trend.danceName}</h2>
              <span className="text-sm text-ink-soft">
                {trend.castSize} in the cast
              </span>
              <span className="ml-auto flex items-baseline gap-2 text-sm">
                <span className="text-ink-soft">
                  latest{" "}
                  <span className="font-semibold tabular-nums text-ink">
                    {trend.latestPercent}%
                  </span>
                </span>
                <span className="text-ink-faint">
                  usually {trend.averagePercent}%
                </span>
                {trend.deltaPercent !== null && (
                  <Delta value={trend.deltaPercent} />
                )}
              </span>
            </div>

            <ul className="mt-3 flex flex-wrap items-end gap-1">
              {trend.weeks.map((week) => (
                <li
                  key={week.weekOf.toISOString()}
                  className="flex w-14 flex-col items-center gap-1"
                  title={`Week of ${formatWeekLabel(week.weekOf)} — ${week.present} of ${week.expected}`}
                >
                  {/* A bar rather than a number, because the shape of six
                      weeks side by side is the thing worth seeing. */}
                  <span
                    className={`w-full rounded-t ${ week.percent >= 80
                        ? "bg-good"
                        : week.percent >= 60
                          ? "bg-warn"
                          : "bg-bad"
                    }`}
                    style={{ height: `${Math.max(3, Math.round(week.percent * 0.44))}px` }}
                  />
                  <span className="text-[10px] tabular-nums text-ink-faint">
                    {week.percent}%
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <details className="rounded-xl border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          Who was missing, week by week
        </summary>
        <div className="mt-3">
          <WeeklyView />
        </div>
      </details>

      <details className="rounded-xl border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          Every practice
        </summary>
        <div className="mt-3">
          <EveryPracticeView />
        </div>
      </details>
    </div>
  );
}

function Delta({ value }: { value: number }) {
  if (value === 0) {
    return <span className="text-xs text-ink-faint">no change</span>;
  }
  const worse = value < 0;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${ worse ? "bg-bad-soft text-bad" : "bg-good-soft text-good"
      }`}
    >
      {worse ? "−" : "+"}
      {Math.abs(value)} pts
    </span>
  );
}

/** Minutes late, per dance, summed by month and by semester.
 *
 * Minutes are the only figure shown, on purpose: the question this screen
 * answers is "how many minutes late was this person", and anything else
 * crowds it. */
async function LatenessView() {
  const semesters = await getLatenessBySemester();

  if (semesters.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-soft">
        Nobody has been late to a practice yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-soft">
        Minutes late per person, broken out by dance and summed for each month
        and each semester. Late is anything past the threshold in Settings; an
        agreed late arrival never counts against anyone.
      </p>

      {semesters.map((semester) => (
        <section
          key={semester.key}
          className="rounded-xl border border-line bg-surface"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="font-semibold text-ink">
              {semester.label}
            </h2>
            <span className="text-sm font-medium text-warn">
              {semester.total} min across the team
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-ink-faint">
                  <th className="px-4 py-2 font-medium">Person / dance</th>
                  {semester.months.map((month) => (
                    <th
                      key={month.key}
                      className="px-3 py-2 text-right font-medium"
                    >
                      {month.label}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right font-medium">Semester</th>
                </tr>
              </thead>
              <tbody>
                {semester.people.map((person) => (
                  <Fragment key={person.userId}>
                    <tr className="border-t border-line bg-surface-2 bg-surface-3/60">
                      <td className="px-4 py-2 font-medium text-ink">
                        {person.name}
                      </td>
                      {semester.months.map((month) => (
                        <td
                          key={month.key}
                          className="px-3 py-2 text-right font-medium text-ink-soft"
                        >
                          {minutesCell(person.byMonth.get(month.key))}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right font-semibold text-warn">
                        {person.total} min
                      </td>
                    </tr>

                    {person.dances.map((dance) => (
                      <tr
                        key={dance.danceId}
                        className="border-t border-line/60"
                      >
                        <td className="py-1.5 pl-8 pr-4 text-ink-soft">
                          {dance.danceName}
                        </td>
                        {semester.months.map((month) => (
                          <td
                            key={month.key}
                            className="px-3 py-1.5 text-right text-ink-soft"
                          >
                            {minutesCell(dance.byMonth.get(month.key))}
                          </td>
                        ))}
                        <td className="px-4 py-1.5 text-right text-ink-soft">
                          {dance.total} min
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function minutesCell(minutes: number | undefined) {
  if (!minutes) {
    return <span className="text-ink-soft">—</span>;
  }
  return `${minutes} min`;
}

async function ByPersonView({
  threshold,
  windowSize,
}: {
  threshold: number;
  windowSize: number;
}) {
  const people = await getPersonRollups(threshold, windowSize);

  if (people.length === 0) {
    return <Empty message="No attendance has been marked yet." />;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-soft">
        Everyone on the roster, worst attendance first. Expand a row to see the
        breakdown per dance. Lateness is reported here but never counts toward
        a flag.
      </p>
      {people.map((person) => (
        <details
          key={person.userId}
          className="rounded-lg border border-line bg-surface p-3"
        >
          <summary className="grid cursor-pointer grid-cols-2 items-center gap-2 text-sm sm:grid-cols-6">
            <Link
              href={`/admin/roster/${person.userId}`} className="font-medium text-ink underline decoration-line-strong decoration-1 underline-offset-2 transition-colors hover:text-accent-ink hover:decoration-accent"
            >
              {person.name}
            </Link>
            <span className="text-ink-soft">
              {person.totalPresent}/{person.totalPractices} attended
            </span>
            <span className="text-ink-soft">
              {person.totalExcused} excused
            </span>
            <span
              className={
                person.totalMinutesLate > 0
                  ? "font-medium text-warn"
                  : "text-ink-soft"
              }
            >
              {person.totalLate} late
              {person.totalMinutesLate > 0 && ` · ${person.totalMinutesLate} min`}
            </span>
            <span
              className={
                person.totalUnexcused > 0
                  ? "font-medium text-bad"
                  : "text-ink-soft"
              }
            >
              {person.totalUnexcused} unexcused
            </span>
            <span className="text-right font-medium text-ink-soft">
              {person.attendanceRate}%
            </span>
          </summary>

          <table className="mt-3 w-full border-t border-line pt-2 text-sm">
            <thead className="text-left text-xs uppercase text-ink-faint">
              <tr>
                <th className="py-1">Dance</th>
                <th className="py-1">Practices</th>
                <th className="py-1">Late</th>
                <th className="py-1">Missed (excused)</th>
                <th className="py-1">Missed (unexcused)</th>
              </tr>
            </thead>
            <tbody>
              {person.perDance.map((cell) => (
                <tr key={cell.danceId}>
                  <td className="py-1 text-ink">
                    {cell.danceName}
                    {cell.isFlagged && (
                      <span className="ml-2 rounded bg-bad-soft px-2 py-0.5 text-[10px] font-medium text-bad">
                        Flagged
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-ink-soft">
                    {cell.present}/{cell.practicesMarked}
                  </td>
                  <td className="py-1 text-ink-soft">
                    {cell.late > 0 ? `${cell.late} · ${cell.minutesLate} min` : "—"}
                  </td>
                  <td className="py-1 text-ink-soft">
                    {cell.excused}
                  </td>
                  <td
                    className={`py-1 ${ cell.unexcused > 0
                        ? "font-medium text-bad"
                        : "text-ink-soft"
                    }`}
                  >
                    {cell.unexcused}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}

async function WeeklyView() {
  const dances = await getWeeklyRollupByDance();

  if (dances.length === 0) {
    return <Empty message="No marked practices yet." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">
        Week by week, for each dance: how much of the cast was missing and who.
      </p>
      {dances.map((dance) => (
        <section
          key={dance.danceId}
          className="rounded-lg border border-line bg-surface p-4"
        >
          <h2 className="mb-3 font-medium text-ink">
            {dance.danceName}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-ink-faint">
                <tr>
                  <th className="py-1 pr-3">Week</th>
                  <th className="py-1 pr-3">Practices</th>
                  <th className="py-1 pr-3">Missing</th>
                  <th className="py-1">Who</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {dance.weeks.map((week) => (
                  <tr key={week.weekOf.toISOString()}>
                    <td className="py-2 pr-3 whitespace-nowrap text-ink-soft">
                      {formatWeekLabel(week.weekOf)}
                    </td>
                    <td className="py-2 pr-3 text-ink-soft">
                      {week.practiceCount}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span
                        className={`font-medium ${ week.absentPercent >= 30
                            ? "text-bad"
                            : "text-ink-soft "
                        }`}
                      >
                        {week.absentNames.length}/{week.castSize} (
                        {week.absentPercent}%)
                      </span>
                    </td>
                    <td className="py-2 text-ink-soft">
                      {week.absentNames.length === 0 ? (
                        <span className="text-good">
                          Full cast
                        </span>
                      ) : (
                        <span>
                          {week.absentNames.join(", ")}
                          {week.unexcusedNames.length > 0 && (
                            <span className="ml-1 text-xs text-bad">
                              ({week.unexcusedNames.length} unexcused)
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

async function EveryPracticeView() {
  const practices = await getPastPracticesWithAttendance();

  if (practices.length === 0) {
    return <Empty message="No practices have happened yet." />;
  }

  // "Not submitted" is the thing that needs chasing now — a practice can
  // have check-ins on it and still be waiting for a choreographer's sign-off.
  const unmarked = practices.filter((p) => p.submittedAt === null);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">
        Every practice that has happened. Choreographers mark their own
        dances — this is so you can see where that hasn&rsquo;t happened yet,
        and step in if you need to.
      </p>

      {unmarked.length > 0 && (
        <section className="rounded-lg border border-warn/35 bg-warn-soft p-4">
          <h2 className="mb-2 text-sm font-semibold text-warn">
            Not submitted yet ({unmarked.length})
          </h2>
          <ul className="flex flex-col gap-1">
            {unmarked.map((p) => (
              <li
                key={p.practiceId}
                className="flex flex-wrap items-center justify-between gap-2 text-sm text-warn"
              >
                <span className="font-medium">{p.danceName}</span>
                <span>{dateFormatter.format(p.startDateTime)}</span>
                <Link
                  href={`/attendance/${p.practiceId}`}
                  className="text-xs font-medium underline"
                >
                  Open →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-3">
        {practices.map((practice) => (
          <details
            key={practice.practiceId}
            className="rounded-lg border border-line bg-surface p-3"
          >
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-ink">
                {practice.danceName}
              </span>
              <span className="text-ink-soft">
                {dateFormatter.format(practice.startDateTime)}
              </span>
              {practice.isMarked ? (
                <span className="text-xs text-ink-soft">
                  {practice.summary.presentCount}/{practice.summary.markedCount}{" "}
                  present · {practice.summary.absentPercent}% missing
                  {practice.summary.unexcusedCount > 0 && (
                    <span className="ml-1 font-medium text-bad">
                      ({practice.summary.unexcusedCount} unexcused)
                    </span>
                  )}
                </span>
              ) : (
                <span className="rounded bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">
                  Nobody checked in
                </span>
              )}
              {practice.summary.lateCount > 0 && (
                <span className="text-xs text-warn">
                  {practice.summary.lateCount} late ·{" "}
                  {practice.summary.totalMinutesLate} min
                </span>
              )}
              <Link
                href={`/attendance/${practice.practiceId}`}
                className="text-xs font-medium text-accent-ink hover:underline"
              >
                Open →
              </Link>
            </summary>
            <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-3">
              {practice.rows.map((row) => (
                <li
                  key={row.userId}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-ink-soft">
                    {row.name}
                  </span>
                  <AttendanceBadge status={row.status} minutesLate={row.minutesLate} />
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <p className="text-sm text-ink-soft">{message}</p>
  );
}
