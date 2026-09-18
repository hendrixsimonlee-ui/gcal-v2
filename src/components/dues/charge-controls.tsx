"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { setMinutesLate, unwaiveCharge, waiveCharge } from "@/lib/actions/dues";
import { formatMoney } from "@/lib/attendance-fees";

export type ChargeCells = {
  attendanceId: string;
  practiceId: string;
  dancerName: string | null;
  when: string;
  danceName: string;
  arrived: string | null;
  minutesLate: number;
  cents: number;
  fullCents: number;
  waivedReason: string | null;
};

/** One line of the charges table, and the panel that opens under it.
 *
 * The whole row is a client component rather than just the button because the
 * panel has to span the table: a fix form crammed into the last column pushes
 * every other row's columns out of line, which on a screen whose whole point
 * is being readable as a spreadsheet is worse than the problem it solves.
 *
 * Three things the AD can do to a charge, in the order they come up:
 *
 * - The minutes are wrong, because the rehearsal didn't start when the
 *   calendar said. Correct them and the charge re-prices itself, at the rates
 *   that were running that day.
 * - The minutes are right but the charge isn't fair. Waive it with a reason,
 *   which the dancer sees, so nobody has to remember why in March.
 * - The whole sheet is wrong. That belongs on the sheet, so there is a link
 *   to it rather than a second way to edit it from here.
 */
export function ChargeRow({
  cells,
  canEdit,
  columns,
}: {
  cells: ChargeCells;
  /** The treasurer reads this table; only the AD changes what it says. */
  canEdit: boolean;
  /** For the panel's colSpan, so it stays right if a column is added. */
  columns: number;
}) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(String(cells.minutesLate));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(work: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await work();
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't save.");
      }
    });
  }

  const waived = cells.waivedReason !== null;

  return (
    <>
      <tr className="border-b border-line">
        {cells.dancerName !== null ? (
          <Td sticky strong>
            {cells.dancerName}
          </Td>
        ) : (
          <Td sticky />
        )}
        <Td>{cells.when}</Td>
        <Td>{cells.danceName}</Td>
        <Td numeric>{cells.minutesLate}</Td>
        <Td>{cells.arrived ?? "—"}</Td>
        <Td numeric strong={!waived} muted={waived}>
          {waived ? (
            <span title={`Waived: ${cells.waivedReason}`}>
              <s className="text-ink-faint">{formatMoney(cells.fullCents)}</s>{" "}
              <span className="text-good">{formatMoney(0)}</span>
            </span>
          ) : (
            formatMoney(cells.cents)
          )}
        </Td>
        <Td>
          {canEdit ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded border border-line-strong px-1.5 py-0.5 text-[11px] font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent-ink"
            >
              {open ? "Close" : "Fix"}
            </button>
          ) : waived ? (
            <span className="text-xs text-good">Waived</span>
          ) : null}
        </Td>
      </tr>

      {waived && !open && (
        <tr className="border-b border-line">
          <Td sticky />
          <td colSpan={columns - 1} className="px-3 pb-2 text-xs text-good">
            Waived: {cells.waivedReason}
          </td>
        </tr>
      )}

      {open && (
        <tr className="border-b border-line-strong bg-surface-2">
          <td colSpan={columns} className="px-3 py-3">
            <div className="flex flex-col gap-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className="font-medium text-ink"
                  htmlFor={`min-${cells.attendanceId}`}
                >
                  Minutes late
                </label>
                <input
                  id={`min-${cells.attendanceId}`}
                  type="number"
                  min={0}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  className="w-16 rounded border border-line-strong bg-surface px-1.5 py-1 tabular-nums text-ink"
                />
                <button
                  type="button"
                  disabled={isPending || minutes === String(cells.minutesLate)}
                  onClick={() =>
                    run(() =>
                      setMinutesLate(cells.attendanceId, Number(minutes)),
                    )
                  }
                  className="rounded bg-accent px-2 py-1 font-medium text-on-accent transition-opacity disabled:opacity-40"
                >
                  Save
                </button>
                <span className="text-ink-faint">
                  Re-prices at the rates that were running that day.
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                {waived ? (
                  <>
                    <span className="text-good">
                      Waived: {cells.waivedReason}
                    </span>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => run(() => unwaiveCharge(cells.attendanceId))}
                      className="rounded border border-line-strong px-2 py-1 font-medium text-ink transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-40"
                    >
                      Charge it after all
                    </button>
                  </>
                ) : (
                  <>
                    <label
                      className="font-medium text-ink"
                      htmlFor={`why-${cells.attendanceId}`}
                    >
                      Waive {formatMoney(cells.fullCents)} because
                    </label>
                    <input
                      id={`why-${cells.attendanceId}`}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Told me beforehand"
                      className="min-w-40 flex-1 rounded border border-line-strong bg-surface px-1.5 py-1 text-ink"
                    />
                    <button
                      type="button"
                      disabled={isPending || reason.trim() === ""}
                      onClick={() =>
                        run(() => waiveCharge(cells.attendanceId, reason))
                      }
                      className="rounded border border-line-strong px-2 py-1 font-medium text-ink transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-40"
                    >
                      Waive it
                    </button>
                    <span className="text-ink-faint">
                      They see the reason on their own page.
                    </span>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                <Link
                  href={`/attendance/${cells.practiceId}`}
                  className="font-medium text-accent-ink underline underline-offset-2"
                >
                  Open this practice&rsquo;s attendance sheet
                </Link>
                <span className="text-ink-faint">
                  to change who was there, or when it really started.
                </span>
              </div>

              {error && <p className="text-bad">{error}</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* The two table cells, duplicated from the ledger rather than imported: that
 * file is a server component and these rows are a client one, and a shared
 * helper would drag it across the boundary. */
function Td({
  children,
  numeric,
  sticky,
  strong,
  muted,
}: {
  children?: React.ReactNode;
  numeric?: boolean;
  sticky?: boolean;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2 ${numeric ? "text-right tabular-nums" : ""} ${
        sticky ? "sticky left-0 bg-canvas font-medium" : ""
      } ${strong ? "font-semibold text-ink" : muted ? "text-ink-faint" : "text-ink-soft"}`}
    >
      {children}
    </td>
  );
}
