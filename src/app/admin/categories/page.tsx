import { prisma } from "@/lib/prisma";
import { addCategory, deleteCategory } from "@/lib/actions/categories";

export default async function CategoriesPage() {
  const categories = await prisma.conflictCategory.findMany({
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Conflict Categories
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Dancers pick one of these when logging a conflict. Mark a category
          excused so it&rsquo;s clear at a glance which absences don&rsquo;t
          count against someone.
        </p>
      </div>

      <form
        action={addCategory}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">
            Category name
          </label>
          <input
            name="name"
            required
            placeholder="e.g. Class, Medical, Work"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" name="isExcused" />
          Excused
        </label>
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
        >
          Add category
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {categories.map((category) => (
              <tr key={category.id}>
                <td className="px-4 py-2 text-zinc-900 dark:text-zinc-50">
                  {category.name}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      category.isExcused
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    {category.isExcused ? "Excused" : "Unexcused"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <form action={deleteCategory.bind(null, category.id)}>
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
