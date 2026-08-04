import { prisma } from "@/lib/prisma";
import { addRosterMember } from "@/lib/actions/roster";
import { RosterRow } from "@/components/roster-row";

export default async function RosterPage() {
  const users = await prisma.user.findMany({
    orderBy: [{ name: "asc" }, { email: "asc" }],
    include: {
      _count: { select: { memberships: true, accounts: true } },
    },
  });

  const linked = users.filter((u) => u.conflictCalendarId).length;
  const signedIn = users.filter((u) => u._count.accounts > 0).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Roster</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Everyone in PADT. Add people by their Google account email before
          they&rsquo;ve signed in — their first sign-in claims the row you made,
          so nothing is duplicated and nothing is lost. Names and emails are
          editable in place: correcting a typo should never mean deleting
          somebody and taking their attendance history with them.
        </p>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
        <span className="text-ink-soft">
          <span className="font-medium tabular-nums text-ink">{users.length}</span>{" "}
          on the roster
        </span>
        <span className="text-ink-soft">
          <span className="font-medium tabular-nums text-ink">{signedIn}</span>{" "}
          have signed in
        </span>
        <span className="text-ink-soft">
          <span className="font-medium tabular-nums text-ink">{linked}</span>{" "}
          have linked a conflict calendar
        </span>
      </div>

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
            className="w-64 rounded-lg border border-line-strong px-3 py-1.5 text-sm bg-surface"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
        >
          Add to roster
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-surface-2 text-left text-xs font-medium uppercase text-ink-soft">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Dances</th>
              <th className="px-4 py-2">Conflict calendar</th>
              <th className="px-4 py-2">Admin</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((user) => (
              <RosterRow
                key={user.id}
                person={{
                  id: user.id,
                  name: user.name,
                  email: user.email,
                  isAdmin: user.isAdmin,
                  danceCount: user._count.memberships,
                  hasSignedIn: user._count.accounts > 0,
                  calendarName: user.conflictCalendarName,
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
