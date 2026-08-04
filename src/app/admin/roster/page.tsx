import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  addRosterMember,
  removeRosterMember,
  toggleAdmin,
} from "@/lib/actions/roster";

export default async function RosterPage() {
  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { memberships: true } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-ink">
        Roster
      </h1>

      <form
        action={addRosterMember}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-soft">Name</label>
          <input
            name="name"
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-soft">
            Email (their Google account email)
          </label>
          <input
            name="email"
            type="email"
            required
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
        >
          Add to roster
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs font-medium uppercase text-ink-soft">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Dances</th>
              <th className="px-4 py-2">Admin</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-2">
                  <Link
                    href={`/admin/roster/${user.id}`}
                    className="font-medium text-ink underline decoration-line-strong decoration-1 underline-offset-2 transition-colors hover:text-accent hover:decoration-accent"
                  >
                    {user.name || (
                      <span className="italic text-ink-faint">
                        Not signed in yet
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-4 py-2 text-ink-soft">
                  {user.email}
                </td>
                <td className="px-4 py-2 text-ink-soft">
                  {user._count.memberships}
                </td>
                <td className="px-4 py-2">
                  <form action={toggleAdmin.bind(null, user.id, !user.isAdmin)}>
                    <button
                      type="submit"
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${ user.isAdmin
                          ? "bg-accent text-on-accent"
                          : "border border-line-strong text-ink-soft "
                      }`}
                    >
                      {user.isAdmin ? "Admin" : "Make admin"}
                    </button>
                  </form>
                </td>
                <td className="px-4 py-2 text-right">
                  <form action={removeRosterMember.bind(null, user.id)}>
                    <button
                      type="submit"
                      className="text-xs font-medium text-ink-faint transition-colors hover:text-bad"
                    >
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
