import {
  getAttendanceSettings,
  updateAttendanceSettings,
} from "@/lib/actions/attendance";

export default async function AdminSettingsPage() {
  const settings = await getAttendanceSettings();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Controls how the system decides someone is missing too many
          practices.
        </p>
      </div>

      <form
        action={updateAttendanceSettings}
        className="flex max-w-xl flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Chronic absence flag
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Flag a dancer once they miss{" "}
          <input
            type="number"
            name="chronicAbsenceThreshold"
            min={1}
            required
            defaultValue={settings.chronicAbsenceThreshold}
            className="mx-1 w-16 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />{" "}
          practices without an excused conflict, out of their last{" "}
          <input
            type="number"
            name="chronicAbsenceWindow"
            min={1}
            required
            defaultValue={settings.chronicAbsenceWindow}
            className="mx-1 w-16 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />{" "}
          practices for that dance.
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Only unexcused absences count toward the flag — an excused conflict
          or a logged out-of-town window never counts against someone.
        </p>

        <hr className="border-zinc-200 dark:border-zinc-800" />

        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Use past attendance when suggesting slots
        </h2>
        <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
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
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          This only ever breaks ties — it is weighted below a real logged
          conflict and needs at least two past practices on a given weekday
          before it infers anything. Switch it off for purely rule-based
          suggestions with no inference from past data.
        </p>

        <div>
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
          >
            Save settings
          </button>
        </div>
      </form>
    </div>
  );
}
