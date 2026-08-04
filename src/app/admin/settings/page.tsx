import {
  getAttendanceSettings,
  updateAttendanceSettings,
} from "@/lib/actions/attendance";
import { TeamCalendarLink } from "@/components/team-calendar-link";
import { TermsManager } from "@/components/terms-manager";
import { listTerms } from "@/lib/terms";

export default async function AdminSettingsPage() {
  const [settings, terms] = await Promise.all([
    getAttendanceSettings(),
    listTerms(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          Settings
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Term dates, the calendars the app reads and writes, and how it
          decides someone is late or missing too many practices.
        </p>
      </div>

      <TermsManager terms={terms} />

      <form
        action={updateAttendanceSettings}
        className="flex max-w-xl flex-col gap-4 rounded-lg border border-line bg-surface p-4"
      >
        <h2 className="text-sm font-semibold text-ink">
          Chronic absence flag
        </h2>
        <p className="text-sm text-ink-soft">
          Flag a dancer once they miss{" "}
          <input
            type="number"
            name="chronicAbsenceThreshold"
            min={1}
            required
            defaultValue={settings.chronicAbsenceThreshold}
            className="mx-1 w-16 rounded-lg border border-line-strong px-2 py-1 text-sm bg-surface"
          />{" "}
          practices without an excused conflict, out of their last{" "}
          <input
            type="number"
            name="chronicAbsenceWindow"
            min={1}
            required
            defaultValue={settings.chronicAbsenceWindow}
            className="mx-1 w-16 rounded-lg border border-line-strong px-2 py-1 text-sm bg-surface"
          />{" "}
          practices for that dance.
        </p>
        <p className="text-xs text-ink-soft">
          Only unexcused absences count toward the flag — an excused conflict
          or a logged out-of-town window never counts against someone.
        </p>

        <hr className="border-line" />

        <h2 className="text-sm font-semibold text-ink">
          When someone counts as late
        </h2>
        <p className="text-sm text-ink-soft">
          Checking in more than{" "}
          <input
            type="number"
            name="lateThresholdMinutes"
            min={0}
            max={60}
            required
            defaultValue={settings.lateThresholdMinutes}
            className="mx-1 w-16 rounded-lg border border-line-strong px-2 py-1 text-sm bg-surface"
          />{" "}
          minutes after the practice starts is recorded as late.
        </p>
        <p className="text-xs text-ink-soft">
          Minutes late are always recorded exactly; this only decides where the
          &ldquo;late&rdquo; label starts. Lateness is tracked separately from
          the chronic-absence flag.
        </p>

        <hr className="border-line" />

        <h2 className="text-sm font-semibold text-ink">
          Use past attendance when suggesting slots
        </h2>
        <label className="flex items-start gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            name="useHistoricalWeighting"
            defaultChecked={settings.useHistoricalWeighting}
            className="mt-1"
          />
          <span>
            Nudge the Schedule Builder away from weekdays a dance&rsquo;s cast
            has historically skipped without an excuse.
          </span>
        </label>
        <p className="text-xs text-ink-soft">
          This only ever breaks ties — it is weighted below a real logged
          conflict and needs at least two past practices on a given weekday
          before it infers anything. Switch it off for purely rule-based
          suggestions with no inference from past data.
        </p>

        <div>
          <button
            type="submit"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            Save settings
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-line bg-surface p-4">
        <TeamCalendarLink linkedName={settings.teamCalendarName} />
      </div>
    </div>
  );
}
