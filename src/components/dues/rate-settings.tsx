"use client";

import { useState, useTransition } from "react";
import {
  deleteFeeSchedule,
  removeCreditCategory,
  saveCreditCategory,
  saveFeeSchedule,
  type RateSettings,
} from "@/lib/actions/dues";
import { formatMoney } from "@/lib/attendance-fees";

/** What being late costs, and what earns money back.
 *
 * Two lists the AD edits. The thing that makes this more than a form is the
 * date on each set of rates: charges are priced by whichever set was in force
 * on the day of the rehearsal, so raising the rates in October leaves
 * September exactly as people were told it. That is why a change here adds a
 * dated set rather than editing the numbers in place, and why the screen says
 * so in a sentence rather than in a tooltip nobody opens. */
export function RateSettingsPanel({ settings }: { settings: RateSettings }) {
  return (
    <div className="flex flex-col gap-6">
      <FeeSchedules schedules={settings.schedules} />
      <CreditCategories categories={settings.categories} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Rates
 * ------------------------------------------------------------------ */

type Draft = { fromMinutes: string; cents: string };

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-08-01" as "1 Aug 2026".
 *
 * Split rather than fed to `new Date`, which would read it as UTC midnight and
 * show the evening before to anyone east of Greenwich — the same class of bug
 * that moves a 7pm rehearsal. There is no instant here to convert; it is three
 * numbers. */
function readableDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1] ?? month} ${year}`;
}

function FeeSchedules({ schedules }: { schedules: RateSettings["schedules"] }) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">
          What being late costs
        </h2>
        <p className="mt-0.5 max-w-2xl text-sm text-ink-soft">
          Each set of rates starts on a date. A charge is priced by whichever
          set was running the day of the rehearsal, so changing the rates now
          never changes what somebody has already been told they owe.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {schedules.map((s) => (
          <li
            key={s.id}
            className="rounded-xl border border-line bg-surface p-3"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-semibold text-ink">
                From {readableDate(s.effectiveFrom)}
              </span>
              {s.isCurrent && (
                <span className="rounded bg-good-soft px-2 py-0.5 text-xs font-medium text-good">
                  In use now
                </span>
              )}
              {s.isFuture && (
                <span className="rounded bg-info-soft px-2 py-0.5 text-xs font-medium text-info">
                  Starts later
                </span>
              )}
              {s.note && <span className="text-xs text-ink-faint">{s.note}</span>}
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(editing === s.id ? null : s.id)}
                  className="rounded border border-line-strong px-2 py-0.5 text-xs font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent-ink"
                >
                  {editing === s.id ? "Cancel" : "Edit"}
                </button>
                {schedules.length > 1 && <DeleteSchedule id={s.id} />}
              </div>
            </div>

            <p className="mt-1.5 text-sm text-ink-soft">
              Under {s.tiers[0]?.fromMinutes ?? 0} minutes is free.{" "}
              {s.tiers
                .map((t) => `${t.fromMinutes} min ${formatMoney(t.cents)}`)
                .join(" · ")}
            </p>

            {editing === s.id && (
              <ScheduleForm
                id={s.id}
                effectiveFrom={s.effectiveFrom}
                note={s.note ?? ""}
                tiers={s.tiers.map((t) => ({
                  fromMinutes: String(t.fromMinutes),
                  cents: (t.cents / 100).toFixed(2),
                }))}
                onDone={() => setEditing(null)}
              />
            )}
          </li>
        ))}
      </ul>

      {editing === "new" ? (
        <div className="rounded-xl border border-line-strong bg-surface p-3">
          <ScheduleForm
            effectiveFrom={new Date().toISOString().slice(0, 10)}
            note=""
            tiers={
              schedules[0]?.tiers.map((t) => ({
                fromMinutes: String(t.fromMinutes),
                cents: (t.cents / 100).toFixed(2),
              })) ?? [{ fromMinutes: "5", cents: "1.00" }]
            }
            onDone={() => setEditing(null)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="self-start rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent-ink"
        >
          New rates from a date
        </button>
      )}
    </section>
  );
}

function ScheduleForm({
  id,
  effectiveFrom,
  note,
  tiers,
  onDone,
}: {
  id?: string;
  effectiveFrom: string;
  note: string;
  tiers: Draft[];
  onDone: () => void;
}) {
  const [from, setFrom] = useState(effectiveFrom);
  const [why, setWhy] = useState(note);
  const [rows, setRows] = useState<Draft[]>(tiers);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function update(i: number, patch: Partial<Draft>) {
    setRows((r) => r.map((row, at) => (at === i ? { ...row, ...patch } : row)));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await saveFeeSchedule({
          id,
          effectiveFrom: from,
          note: why,
          // Dollars on screen, cents underneath. Rounding here rather than
          // trusting the float is the difference between $2.00 and 199 cents.
          tiers: rows.map((r) => ({
            fromMinutes: Number(r.fromMinutes),
            cents: Math.round(Number(r.cents) * 100),
          })),
        });
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't save.");
      }
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label className="font-medium text-ink">Starts</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded border border-line-strong bg-surface px-2 py-1 text-ink"
        />
        <input
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          placeholder="Why it changed (optional)"
          className="min-w-40 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-ink"
        />
      </div>

      <table className="w-full max-w-md border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            <th className="py-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
              From (minutes)
            </th>
            <th className="py-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
              Charge
            </th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line">
              <td className="py-1 pr-2">
                <input
                  type="number"
                  min={0}
                  value={row.fromMinutes}
                  onChange={(e) => update(i, { fromMinutes: e.target.value })}
                  className="w-20 rounded border border-line-strong bg-surface px-1.5 py-1 tabular-nums text-ink"
                />
              </td>
              <td className="py-1 pr-2">
                <span className="text-ink-soft">$</span>{" "}
                <input
                  type="number"
                  min={0}
                  step="0.25"
                  value={row.cents}
                  onChange={(e) => update(i, { cents: e.target.value })}
                  className="w-24 rounded border border-line-strong bg-surface px-1.5 py-1 tabular-nums text-ink"
                />
              </td>
              <td className="py-1">
                <button
                  type="button"
                  onClick={() => setRows((r) => r.filter((_, at) => at !== i))}
                  disabled={rows.length === 1}
                  className="text-xs text-ink-soft underline underline-offset-2 disabled:opacity-30"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            setRows((r) => [...r, { fromMinutes: "", cents: "" }])
          }
          className="rounded border border-line-strong px-2 py-1 text-xs font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent-ink"
        >
          Add a step
        </button>
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-opacity disabled:opacity-40"
        >
          {id ? "Save these rates" : "Add these rates"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-sm text-ink-soft underline underline-offset-2"
        >
          Cancel
        </button>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

function DeleteSchedule({ id }: { id: string }) {
  const [sure, setSure] = useState(false);
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!sure) {
          setSure(true);
          return;
        }
        startTransition(() => deleteFeeSchedule(id));
      }}
      className={`rounded border px-2 py-0.5 text-xs font-medium transition-colors ${ sure
          ? "border-bad text-bad"
          : "border-line-strong text-ink-soft hover:border-bad hover:text-bad"
      }`}
    >
      {sure ? "Really delete" : "Delete"}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Credits
 * ------------------------------------------------------------------ */

function CreditCategories({
  categories,
}: {
  categories: RateSettings["categories"];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-6">
      <div>
        <h2 className="text-sm font-semibold text-ink">
          What earns money back
        </h2>
        <p className="mt-0.5 max-w-2xl text-sm text-ink-soft">
          Add whatever your club actually credits people for. Changing an
          amount only affects credits logged from now on, because each one
          keeps what it was worth on the day it was earned.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {categories.map((c) => (
          <CategoryRow key={c.id} category={c} />
        ))}
      </ul>

      {adding ? (
        <CategoryForm onDone={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="self-start rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent-ink"
        >
          Add a category
        </button>
      )}
    </section>
  );
}

function CategoryRow({
  category,
}: {
  category: RateSettings["categories"][number];
}) {
  const [editing, setEditing] = useState(false);
  const [sure, setSure] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (editing) {
    return (
      <li className="rounded-xl border border-line-strong bg-surface p-3">
        <CategoryForm
          id={category.id}
          name={category.name}
          dollars={(category.cents / 100).toFixed(2)}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-surface px-3 py-2">
      <span className="font-medium text-ink">{category.name}</span>
      <span className="tabular-nums text-good">
        {formatMoney(-category.cents)}
      </span>
      <div className="ml-auto flex gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded border border-line-strong px-2 py-0.5 text-xs font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent-ink"
        >
          Edit
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (!sure) {
              setSure(true);
              return;
            }
            startTransition(() => removeCreditCategory(category.id));
          }}
          className={`rounded border px-2 py-0.5 text-xs font-medium transition-colors ${ sure
              ? "border-bad text-bad"
              : "border-line-strong text-ink-soft hover:border-bad hover:text-bad"
          }`}
        >
          {sure
            ? category.inUse
              ? "Really remove"
              : "Really delete"
            : "Remove"}
        </button>
      </div>
      {sure && category.inUse && (
        <p className="w-full text-xs text-ink-faint">
          People have already earned this one, so it stays on their ledger and
          just stops appearing on the list.
        </p>
      )}
    </li>
  );
}

function CategoryForm({
  id,
  name: initialName,
  dollars: initialDollars,
  onDone,
}: {
  id?: string;
  name?: string;
  dollars?: string;
  onDone: () => void;
}) {
  const [name, setName] = useState(initialName ?? "");
  const [dollars, setDollars] = useState(initialDollars ?? "1.00");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await saveCreditCategory({
          id,
          name,
          cents: Math.round(Number(dollars) * 100),
        });
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't save.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Helped at auditions"
          className="min-w-48 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-ink"
        />
        <span className="text-ink-soft">worth $</span>
        <input
          type="number"
          min={0}
          step="0.25"
          value={dollars}
          onChange={(e) => setDollars(e.target.value)}
          className="w-24 rounded border border-line-strong bg-surface px-2 py-1 tabular-nums text-ink"
        />
        <button
          type="button"
          onClick={save}
          disabled={isPending || name.trim() === ""}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-opacity disabled:opacity-40"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-sm text-ink-soft underline underline-offset-2"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
