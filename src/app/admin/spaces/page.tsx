import { prisma } from "@/lib/prisma";
import { DAY_NAMES } from "@/lib/constants";
import {
  addSpace,
  addRecurringAvailability,
  deleteAvailability,
  deleteSpace,
} from "@/lib/actions/spaces";

export default async function SpacesPage() {
  const spaces = await prisma.space.findMany({
    orderBy: { name: "asc" },
    include: { availabilities: { orderBy: { dayOfWeek: "asc" } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Spaces
      </h1>

      <form
        action={addSpace}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">
            Space name
          </label>
          <input
            name="name"
            required
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">
            Location
          </label>
          <input
            name="location"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
        >
          Add space
        </button>
      </form>

      <div className="flex flex-col gap-4">
        {spaces.map((space) => (
          <section
            key={space.id}
            className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-medium text-zinc-900 dark:text-zinc-50">
                  {space.name}
                </h2>
                {space.location && (
                  <p className="text-xs text-zinc-500">{space.location}</p>
                )}
              </div>
              <form action={deleteSpace.bind(null, space.id)}>
                <button
                  type="submit"
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Delete space
                </button>
              </form>
            </div>

            <ul className="mb-3 flex flex-col gap-1">
              {space.availabilities.length === 0 && (
                <li className="text-sm text-zinc-500">
                  No availability windows yet.
                </li>
              )}
              {space.availabilities.map((slot) => (
                <li
                  key={slot.id}
                  className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-1.5 text-sm dark:bg-zinc-800"
                >
                  <span>
                    {slot.dayOfWeek !== null
                      ? DAY_NAMES[slot.dayOfWeek]
                      : "One-off"}{" "}
                    {slot.startTime}–{slot.endTime}
                  </span>
                  <form action={deleteAvailability.bind(null, slot.id)}>
                    <button
                      type="submit"
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>

            <form
              action={addRecurringAvailability.bind(null, space.id)}
              className="flex flex-wrap items-end gap-2"
            >
              <select
                name="dayOfWeek"
                required
                className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              >
                {DAY_NAMES.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
              <input
                type="time"
                name="startTime"
                required
                className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
              <span className="text-sm text-zinc-500">to</span>
              <input
                type="time"
                name="endTime"
                required
                className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Add weekly window
              </button>
            </form>
          </section>
        ))}
      </div>
    </div>
  );
}
