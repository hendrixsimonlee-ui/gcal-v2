import { setConflictNudgeSchedule } from "@/lib/actions/notifications";

const DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

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
}: {
  enabled: boolean;
  weekday: number;
  hour: number;
  minute: number;
}) {
  return (
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
            Off by default. You can always nudge by hand from Conflict Review
            instead — this just saves you remembering.
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
        It goes out within about fifteen minutes of the time you set, and only
        once a week however often the app checks.
      </p>
    </form>
  );
}
