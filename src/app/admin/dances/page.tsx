import { prisma } from "@/lib/prisma";
import {
  addDance,
  addMembership,
  deleteDance,
  removeMembership,
  setDanceArchived,
  setDanceDefaultDuration,
} from "@/lib/actions/dances";

const archivedFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default async function DancesPage() {
  const [allDances, users] = await Promise.all([
    prisma.dance.findMany({
      orderBy: { name: "asc" },
      include: {
        memberships: {
          include: { user: true },
          orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
        },
        _count: { select: { practices: true } },
      },
    }),
    prisma.user.findMany({ orderBy: { name: "asc" } }),
  ]);

  const dances = allDances.filter((d) => d.archivedAt === null);
  const archived = allDances.filter((d) => d.archivedAt !== null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Dances
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          When a piece finishes its run, archive it. It disappears from the
          Schedule Builder and from everyone&rsquo;s personal screens, but all
          its practices and attendance stay in the system and come back if you
          unarchive it.
        </p>
      </div>

      <form
        action={addDance}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">
            Dance name
          </label>
          <input
            name="name"
            required
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">Season</label>
          <input
            name="season"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
        >
          Add dance
        </button>
      </form>

      <div className="flex flex-col gap-4">
        {dances.map((dance) => (
          <section
            key={dance.id}
            className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-medium text-zinc-900 dark:text-zinc-50">
                  {dance.name}
                </h2>
                {dance.season && (
                  <p className="text-xs text-zinc-500">{dance.season}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <form
                  action={setDanceDefaultDuration.bind(null, dance.id)}
                  className="flex items-center gap-1.5"
                >
                  <label className="text-xs text-zinc-500">
                    Usual practice length
                  </label>
                  <input
                    type="number"
                    name="defaultDurationMinutes"
                    min={15}
                    max={480}
                    step={15}
                    defaultValue={dance.defaultDurationMinutes}
                    className="w-20 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                  />
                  <span className="text-xs text-zinc-500">min</span>
                  <button
                    type="submit"
                    className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
                  >
                    Save
                  </button>
                </form>
                <form action={setDanceArchived.bind(null, dance.id, true)}>
                  <button
                    type="submit"
                    className="text-xs font-medium text-zinc-500 hover:underline"
                  >
                    Archive
                  </button>
                </form>
                <form action={deleteDance.bind(null, dance.id)}>
                  <button
                    type="submit"
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    Delete dance
                  </button>
                </form>
              </div>
            </div>

            <ul className="mb-3 flex flex-col gap-1">
              {dance.memberships.length === 0 && (
                <li className="text-sm text-zinc-500">No members yet.</li>
              )}
              {dance.memberships.map((membership) => (
                <li
                  key={membership.id}
                  className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-1.5 text-sm dark:bg-zinc-800"
                >
                  <span>
                    {membership.user.name || membership.user.email}{" "}
                    <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                      {membership.role === "CHOREOGRAPHER"
                        ? "Choreographer"
                        : "Dancer"}
                    </span>
                  </span>
                  <form action={removeMembership.bind(null, membership.id)}>
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
              action={addMembership.bind(null, dance.id)}
              className="flex flex-wrap items-end gap-2"
            >
              <select
                name="userId"
                required
                className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              >
                <option value="">Select person…</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name || user.email}
                  </option>
                ))}
              </select>
              <select
                name="role"
                required
                className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              >
                <option value="DANCER">Dancer</option>
                <option value="CHOREOGRAPHER">Choreographer</option>
              </select>
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Add to dance
              </button>
            </form>
          </section>
        ))}
        {dances.length === 0 && (
          <p className="text-sm text-zinc-500">
            No active dances. Add one above, or unarchive a past piece.
          </p>
        )}
      </div>

      {archived.length > 0 && (
        <details className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Archived dances ({archived.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-1">
            {archived.map((dance) => (
              <li
                key={dance.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800"
              >
                <span className="text-zinc-800 dark:text-zinc-200">
                  {dance.name}
                  {dance.season && (
                    <span className="ml-2 text-xs text-zinc-500">
                      {dance.season}
                    </span>
                  )}
                </span>
                <span className="text-xs text-zinc-500">
                  {dance._count.practices} practice
                  {dance._count.practices === 1 ? "" : "s"} kept · archived{" "}
                  {archivedFormatter.format(dance.archivedAt!)}
                </span>
                <form action={setDanceArchived.bind(null, dance.id, false)}>
                  <button
                    type="submit"
                    className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
                  >
                    Unarchive
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
