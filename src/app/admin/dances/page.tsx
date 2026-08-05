import { prisma } from "@/lib/prisma";
import {
  addDance,
  addMembership,
  deleteDance,
  removeMembership,
  setDanceArchived,
  setDanceDefaultDuration,
} from "@/lib/actions/dances";
import { APP_TIME_ZONE } from "@/lib/timezone";

const archivedFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
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
        <h1 className="text-xl font-semibold text-ink">
          Dances
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          When a piece finishes its run, archive it. It disappears from the
          Schedule Builder and from everyone&rsquo;s personal screens, but all
          its practices and attendance stay in the system and come back if you
          unarchive it.
        </p>
      </div>

      <form
        action={addDance}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-soft">
            Dance name
          </label>
          <input
            name="name"
            required
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-soft">Season</label>
          <input
            name="season"
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
        >
          Add dance
        </button>
      </form>

      <div className="flex flex-col gap-4">
        {dances.map((dance) => (
          <section
            key={dance.id}
            className="rounded-lg border border-line bg-surface p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-medium text-ink">
                  {dance.name}
                </h2>
                {dance.season && (
                  <p className="text-xs text-ink-soft">{dance.season}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <form
                  action={setDanceDefaultDuration.bind(null, dance.id)}
                  className="flex items-center gap-1.5"
                >
                  <label className="text-xs text-ink-soft">
                    Usual practice length
                  </label>
                  <input
                    type="number"
                    name="defaultDurationMinutes"
                    min={15}
                    max={480}
                    step={15}
                    defaultValue={dance.defaultDurationMinutes}
                    className="w-20 rounded-lg border border-line-strong px-2 py-1 text-sm bg-surface"
                  />
                  <span className="text-xs text-ink-soft">min</span>
                  <button
                    type="submit"
                    className="text-xs font-medium text-accent-ink hover:underline"
                  >
                    Save
                  </button>
                </form>
                <form action={setDanceArchived.bind(null, dance.id, true)}>
                  <button
                    type="submit"
                    className="text-xs font-medium text-ink-soft hover:underline"
                  >
                    Archive
                  </button>
                </form>
                <form action={deleteDance.bind(null, dance.id)}>
                  <button
                    type="submit"
                    className="text-xs font-medium text-ink-faint transition-colors hover:text-bad"
                  >
                    Delete dance
                  </button>
                </form>
              </div>
            </div>

            <ul className="mb-3 flex flex-col gap-1">
              {dance.memberships.length === 0 && (
                <li className="text-sm text-ink-soft">No members yet.</li>
              )}
              {dance.memberships.map((membership) => (
                <li
                  key={membership.id}
                  className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-1.5 text-sm bg-surface"
                >
                  <span>
                    {membership.user.name || membership.user.email}{" "}
                    <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-ink-soft">
                      {membership.role === "CHOREOGRAPHER"
                        ? "Choreographer"
                        : "Dancer"}
                    </span>
                  </span>
                  <form action={removeMembership.bind(null, membership.id)}>
                    <button
                      type="submit"
                      className="text-xs font-medium text-ink-faint transition-colors hover:text-bad"
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
                className="rounded-lg border border-line-strong px-2 py-1.5 text-sm bg-surface"
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
                className="rounded-lg border border-line-strong px-2 py-1.5 text-sm bg-surface"
              >
                <option value="DANCER">Dancer</option>
                <option value="CHOREOGRAPHER">Choreographer</option>
              </select>
              <button
                type="submit"
                className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-surface-3"
              >
                Add to dance
              </button>
            </form>
          </section>
        ))}
        {dances.length === 0 && (
          <p className="text-sm text-ink-soft">
            No active dances. Add one above, or unarchive a past piece.
          </p>
        )}
      </div>

      {archived.length > 0 && (
        <details className="rounded-lg border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            Archived dances ({archived.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-1">
            {archived.map((dance) => (
              <li
                key={dance.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm bg-surface"
              >
                <span className="text-ink">
                  {dance.name}
                  {dance.season && (
                    <span className="ml-2 text-xs text-ink-soft">
                      {dance.season}
                    </span>
                  )}
                </span>
                <span className="text-xs text-ink-soft">
                  {dance._count.practices} practice
                  {dance._count.practices === 1 ? "" : "s"} kept · archived{" "}
                  {archivedFormatter.format(dance.archivedAt!)}
                </span>
                <form action={setDanceArchived.bind(null, dance.id, false)}>
                  <button
                    type="submit"
                    className="text-xs font-medium text-accent-ink hover:underline"
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
