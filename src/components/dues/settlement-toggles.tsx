"use client";

import { useState, useTransition } from "react";
import { setSettlement } from "@/lib/actions/dues";

/** The two ticks at the end of a ledger row.
 *
 * Optimistic on purpose. The AD goes down a column of forty people ticking as
 * they work through Venmo, and a half-second of nothing after each tap makes
 * that feel broken enough that people double-tap and undo themselves. So the
 * box flips immediately and rolls back only if the server says no. */
export function SettlementToggle({
  userId,
  month,
  year,
  field,
  value,
  label,
  disabled,
}: {
  userId: string;
  month: number;
  year: number;
  field: "venmoRequested" | "isPaid";
  value: boolean;
  label: string;
  disabled?: boolean;
}) {
  const [on, setOn] = useState(value);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function flip() {
    const next = !on;
    setOn(next);
    setFailed(false);
    startTransition(async () => {
      try {
        await setSettlement(userId, month, year, field, next);
      } catch {
        setOn(!next);
        setFailed(true);
      }
    });
  }

  return (
    <label
      className={`flex items-center gap-1.5 text-xs ${ disabled ? "opacity-40" : "cursor-pointer"
      }`}
      title={failed ? "That didn't save. Try again." : undefined}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={flip}
        disabled={disabled || isPending}
        className="size-4 accent-accent"
      />
      <span className={failed ? "font-medium text-bad" : "text-ink-soft"}>
        {failed ? "Didn't save" : label}
      </span>
    </label>
  );
}
