import { prisma } from "@/lib/prisma";
import { deleteConflict, updateConflictCategory } from "@/lib/actions/conflicts";
import { ConflictCategorySelect } from "@/components/conflict-category-select";
import { addDays, formatWeekLabel } from "@/lib/dates";

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

export default async function AdminConflictsPage() {
  const [conflicts, categories] = await Promise.all([
    prisma.conflict.findMany({
      where: { weekOf: { gte: addDays(new Date(), -7) } },
      orderBy: [{ weekOf: "asc" }, { startDateTime: "asc" }],
      include: { category: true, user: true },
    }),
    prisma.conflictCategory.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Conflict Review
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every conflict logged by the roster, current week onward. Recategorize
          or delete anything here — including entries imported from Google
          Calendar.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-2">Person</th>
              <th className="px-4 py-2">Week</th>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Note</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {conflicts.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-zinc-500"
                >
                  No conflicts logged yet.
                </td>
              </tr>
            )}
            {conflicts.map((conflict) => (
              <tr key={conflict.id}>
                <td className="px-4 py-2 text-zinc-900 dark:text-zinc-50">
                  {conflict.user.name || conflict.user.email}
                </td>
                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                  {formatWeekLabel(conflict.weekOf)}
                </td>
                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                  {timeFormatter.format(conflict.startDateTime)} –{" "}
                  {timeFormatter.format(conflict.endDateTime)}
                </td>
                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                  {conflict.note ?? "—"}
                </td>
                <td className="px-4 py-2">
                  <ConflictCategorySelect
                    action={updateConflictCategory.bind(null, conflict.id)}
                    categories={categories}
                    defaultCategoryId={conflict.categoryId ?? ""}
                    isExcused={conflict.category?.isExcused}
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <form action={deleteConflict.bind(null, conflict.id)}>
                    <button
                      type="submit"
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Delete
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
