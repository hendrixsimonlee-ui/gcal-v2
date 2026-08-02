"use client";

type Category = { id: string; name: string; isExcused: boolean };

export function ConflictCategorySelect({
  action,
  categories,
  defaultCategoryId,
  isExcused,
}: {
  action: (formData: FormData) => void;
  categories: Category[];
  defaultCategoryId: string;
  isExcused: boolean | undefined;
}) {
  return (
    <form action={action}>
      <select
        name="categoryId"
        defaultValue={defaultCategoryId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={`rounded-full border-0 px-2 py-0.5 text-xs font-medium ${
          isExcused === true
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
            : isExcused === false
              ? "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
        }`}
      >
        <option value="">Uncategorized</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </form>
  );
}
