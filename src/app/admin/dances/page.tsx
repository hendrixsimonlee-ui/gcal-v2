import { prisma } from "@/lib/prisma";
import {
  addDance,
  addMembership,
  deleteDance,
  removeMembership,
} from "@/lib/actions/dances";

export default async function DancesPage() {
  const [dances, users] = await Promise.all([
    prisma.dance.findMany({
      orderBy: { name: "asc" },
      include: {
        memberships: {
          include: { user: true },
          orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
        },
      },
    }),
    prisma.user.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Dances
      </h1>

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
              <form action={deleteDance.bind(null, dance.id)}>
                <button
                  type="submit"
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Delete dance
                </button>
              </form>
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
      </div>
    </div>
  );
}
