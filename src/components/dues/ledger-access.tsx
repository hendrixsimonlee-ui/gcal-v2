"use client";

import { useState, useTransition } from "react";
import { setFinanceAdmin, type LedgerAccessRow } from "@/lib/actions/dues";

/** Who else can open this screen, tucked into its corner.
 *
 * It used to be a button on each Roster row, which read as one of the things
 * you do to a person — sitting between "Make admin" and "Remove" — when it is
 * really a fact about this page. Somebody scanning the Roster for a phone
 * number had no reason to meet it.
 *
 * Folded away because it is set roughly once a year: one treasurer, one tap,
 * and then nobody touches it again until the committee changes. */
export function LedgerAccess({ people }: { people: LedgerAccessRow[] }) {
  const [open, setOpen] = useState(false);
  const holders = people.filter((p) => p.isFinanceAdmin);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent-ink"
      >
        Who can open this
        <span className="rounded bg-surface-3 px-1.5 py-0.5 tabular-nums text-ink-faint">
          {holders.length === 0 ? "just you" : holders.length}
        </span>
      </button>

      {open && (
        <>
          {/* A click anywhere else closes it, which is what a small panel in a
              corner has to do or it stays open behind the table. */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          {/* Anchored to whichever edge the button is actually on. The header
              wraps on a phone, putting the button at the left, and a panel
              still hanging off its right corner runs clean off the screen. */}
          <div className="absolute left-0 z-20 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line-strong bg-surface p-3 shadow-lg sm:left-auto sm:right-0 sm:w-80">
            <p className="text-xs text-ink-soft">
              Give somebody this one page and nothing else: no casting, no room
              bookings, no schedule builder, no conflict notes. They keep their
              normal navigation with one extra link. They can tick Venmo and
              Paid, but not change the rates or write a charge off.
            </p>
            {/* Forty names don't fit, so this scrolls. The rule above it is
                what makes a half-visible row at the bottom read as "there is
                more" rather than as a panel that got cut off. */}
            <ul className="mt-2.5 flex max-h-64 flex-col gap-0.5 overflow-y-auto border-t border-line pt-1.5">
              {people.map((person) => (
                <AccessRow key={person.userId} person={person} />
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function AccessRow({ person }: { person: LedgerAccessRow }) {
  const [on, setOn] = useState(person.isFinanceAdmin);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  // An admin already has the page, so there is nothing here to switch on and
  // a switch that did nothing would only suggest it took something away.
  if (person.isAdmin) {
    return (
      <li className="flex items-center justify-between rounded px-1.5 py-1 text-sm">
        <span className="text-ink-soft">{person.name}</span>
        <span className="text-xs text-ink-faint">Admin, has it already</span>
      </li>
    );
  }

  function flip() {
    const next = !on;
    setOn(next);
    setFailed(false);
    startTransition(async () => {
      try {
        await setFinanceAdmin(person.userId, next);
      } catch {
        setOn(!next);
        setFailed(true);
      }
    });
  }

  return (
    <li>
      <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm transition-colors hover:bg-surface-2">
        <input
          type="checkbox"
          checked={on}
          onChange={flip}
          disabled={isPending}
          className="size-4 accent-accent"
        />
        <span className="text-ink">{person.name}</span>
        {failed && (
          <span className="ml-auto text-xs font-medium text-bad">
            Didn&rsquo;t save
          </span>
        )}
      </label>
    </li>
  );
}
