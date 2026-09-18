import {
  setConflictNudgeSchedule,
  skipConflictReminderWeek,
  unskipConflictReminderWeek,
} from "@/lib/actions/notifications";
import { APP_TIME_ZONE } from "@/lib/timezone";

/** Sunday is 0, not 7.
 *
 * The job that sends these reads the weekday off the clock, where Sunday is
 * 0 and Saturday is 6. This list used to end with Sunday as 7, a number that
 * day never has — so an AD who picked Sunday got a reminder that silently
 * never fired. Thursday happened to be 4 either way, which is why it went
 * unnoticed. */
const DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

const weekLabel = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
});

/** "Dec 22 to Dec 28" from the Monday key, without letting a bare date key
 * drift a day by being read as UTC. */
function describeWeek(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const monday = new Date(Date.UTC(y, m - 1, d, 12));
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  return `${weekLabel.format(monday)} to ${weekLabel.format(sunday)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** When the weekly conflicts nudge goes out.
 *
 * Every other message in the app happens because the AD pressed something.
 * This is the exception, so it is off until they set it, and the copy says
 * exactly who will be messaged and about which week — a recurring message to
 * forty people is not a thing to switch on without knowing that. */
export function ConflictNudgeSchedule({
  enabled,
  weekday,
  hour,
  minute,
  skippedWeeks,
}: {
  enabled: boolean;
  weekday: number;
  hour: number;
  minute: number;
  skippedWeeks: string[];
}) {
  return (
    <div className="flex max-w-xl flex-col gap-4">
    <form
      action={setConflictNudgeSchedule}
      className="flex max-w-xl flex-col gap-4 rounded-lg border border-line bg-surface p-4"
    >
      <div>
        <h2 className="text-sm font-semibold text-ink">
          Weekly conflicts reminder
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          A push notification to everyone who hasn&rsquo;t submitted their
          conflicts yet for the week starting the following Monday. Anyone
          who has already submitted is left alone, and if everybody has, it
          doesn&rsquo;t send at all.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="conflictNudgeEnabled"
          defaultChecked={enabled}
          className="mt-1"
        />
        <span>
          Send it automatically every week
          <span className="mt-0.5 block text-xs text-ink-soft">
            On, sending Thursday at noon. Untick to stop both reminders
            entirely; to silence one week, use Weeks to skip below. You can
            always nudge by hand from Conflict Review whatever this says.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Day
          <select
            name="conflictNudgeWeekday"
            defaultValue={weekday}
            className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
          >
            {DAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Time (Eastern)
          <input
            type="time"
            name="conflictNudgeTime"
            defaultValue={`${pad(hour)}:${pad(minute)}`}
            className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm tabular-nums text-ink"
          />
        </label>

        <button
          type="submit"
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          Save
        </button>
      </div>

      <p className="text-xs text-ink-faint">
        Both messages go out within about fifteen minutes of the times above,
        and each only once a week however often the app checks.
      </p>
    </form>

    {/* Breaks. The schedule above is a standing arrangement and there is no
        sense making the AD switch the whole thing off and remember to switch
        it back on for one quiet week. */}
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">Weeks to skip</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Breaks, mostly. Nobody needs chasing about conflicts for a week the
          troupe isn&rsquo;t rehearsing. Both reminders stay quiet for any week
          listed here, and the schedule above carries on as normal for every
          other week.
        </p>
      </div>

      {skippedWeeks.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {skippedWeeks.map((week) => (
            <li
              key={week}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm"
            >
              <span className="tabular-nums text-ink">
                {describeWeek(week)}
              </span>
              <form action={unskipConflictReminderWeek}>
                <input type="hidden" name="weekOf" value={week} />
                <button
                  type="submit"
                  className="text-xs font-medium text-ink-soft hover:text-accent-ink hover:underline"
                >
                  Remind after all
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-faint">
          No weeks skipped. Reminders go out every week.
        </p>
      )}

      <form
        action={skipConflictReminderWeek}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Skip the week containing
          <input
            type="date"
            name="weekOf"
            required
            className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm tabular-nums text-ink"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent-ink"
        >
          Skip that week
        </button>
      </form>
      <p className="text-xs text-ink-faint">
        Any date in the week will do. It means the week people would be
        submitting conflicts <em>for</em>, not the week the reminder would be
        sent in.
      </p>
    </div>
    </div>
  );
}
