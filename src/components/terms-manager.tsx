"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addTerm,
  deleteTerm,
  setCurrentTerm,
  updateTerm,
} from "@/lib/actions/terms";
import type { TermRange } from "@/lib/terms";

/** Terms are the unit the team actually thinks in — "Fall 2026" rather than
 * "the next 18 weeks". Defined once here, they become the default range for
 * every calendar sync, slot search and report, which is also what lets any of
 * those reach backwards into a term that has already finished. */
export function TermsManager({ terms }: { terms: TermRange[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        setEditingId(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work.");
      }
    });
  }

  return (
    <section className="flex max-w-xl flex-col gap-4 rounded-lg border border-line bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">
          Terms
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Set each term&rsquo;s dates once. Everywhere the app needs a date
          range — syncing calendars, searching for slots, reporting attendance
          — it uses the current term instead of asking you again.
        </p>
      </div>

      {terms.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong p-3 text-sm text-ink-soft">
          No terms yet. Until you add one, the app falls back to the current
          calendar year.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {terms.map((term) =>
            editingId === term.id ? (
              <li key={term.id} className="py-3">
                <TermFields
                  term={term}
                  disabled={isPending}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(fd) => run(() => updateTerm(term.id, fd))}
                />
              </li>
            ) : (
              <li
                key={term.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-ink">
                    {term.name}
                    {term.isCurrent && (
                      <span className="ml-2 rounded-full bg-good-soft px-2 py-0.5 text-xs font-medium text-good">
                        Current
                      </span>
                    )}
                  </p>
                  <p className="text-xs tabular-nums text-ink-soft">
                    {term.startKey} to {term.endKey}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {!term.isCurrent && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => run(() => setCurrentTerm(term.id))}
                      className="font-medium text-accent-ink hover:underline disabled:opacity-45"
                    >
                      Make current
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setEditingId(term.id)}
                    className="font-medium text-ink-soft hover:underline disabled:opacity-45"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => deleteTerm(term.id))}
                    className="font-medium text-ink-faint transition-colors hover:text-bad disabled:opacity-45"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          Add a term
        </summary>
        <div className="mt-3">
          <TermFields
            disabled={isPending}
            onSubmit={(fd) => run(() => addTerm(fd))}
          />
        </div>
      </details>

      <p className="text-xs text-ink-soft">
        Deleting a term only removes the label. Practices, conflicts and
        attendance inside it are kept — they&rsquo;re stored by date.
      </p>

      {error && (
        <p className="text-sm font-medium text-bad">
          {error}
        </p>
      )}
    </section>
  );
}

function TermFields({
  term,
  disabled,
  onSubmit,
  onCancel,
}: {
  term?: TermRange;
  disabled: boolean;
  onSubmit: (formData: FormData) => void;
  onCancel?: () => void;
}) {
  return (
    <form action={onSubmit} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-soft">
          Name
        </span>
        <input
          name="name"
          required
          placeholder="Fall 2026"
          defaultValue={term?.name}
          className="w-40 rounded-lg border border-line-strong px-2 py-1 text-sm bg-surface"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-soft">
          Starts
        </span>
        <input
          type="date"
          name="startDate"
          required
          min="2026-01-01"
          defaultValue={term?.startKey}
          className="rounded-lg border border-line-strong px-2 py-1 text-sm bg-surface"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-soft">
          Ends
        </span>
        <input
          type="date"
          name="endDate"
          required
          min="2026-01-01"
          defaultValue={term?.endKey}
          className="rounded-lg border border-line-strong px-2 py-1 text-sm bg-surface"
        />
      </label>
      <button
        type="submit"
        disabled={disabled}
        className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-45"
      >
        {term ? "Save" : "Add term"}
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-ink-soft hover:underline"
        >
          Cancel
        </button>
      )}
    </form>
  );
}
