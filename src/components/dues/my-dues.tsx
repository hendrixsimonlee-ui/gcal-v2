import { getMyDues } from "@/lib/actions/dues";
import { formatMoney, monthLabel } from "@/lib/attendance-fees";
import { APP_TIME_ZONE } from "@/lib/timezone";

/** What one dancer owes, and only ever their own.
 *
 * `getMyDues` takes no user id — it reads the session — so there is no
 * argument here anyone could change to look at somebody else's money.
 *
 * Shaped as one big number and then the detail behind it, because the
 * question people actually arrive with is "do I owe anything", and making
 * them add up a table to find out is how a fine becomes a grievance. The
 * months are collapsed by default and open one at a time. */
export async function MyDues({ term }: { term: string }) {
  const dues = await getMyDues(term);
  const withCharges = dues.months.filter(
    (m) => m.incidents.length > 0 || m.netCents > 0,
  );

  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-ink-soft">
        {dues.term}. A few minutes is free, and if you agreed in advance to
        arrive late you&rsquo;re measured from the time you agreed. If
        something here looks wrong, tell the AD.
      </p>

      {/* The one number somebody came here for. */}
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="text-sm font-medium text-ink-soft">
          You owe for {dues.term}
        </div>
        <div
          className={`mt-1 text-4xl font-semibold tabular-nums ${ dues.outstandingCents > 0 ? "text-accent-ink" : "text-good"
          }`}
        >
          {formatMoney(dues.outstandingCents)}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          <Stat label="Charged" value={formatMoney(dues.totals.grossCents)} />
          <Stat
            label="Credits used"
            value={formatMoney(-dues.totals.appliedCents)}
            tone="good"
          />
          <Stat
            label="Credits banked"
            value={formatMoney(dues.totals.bankedCents)}
            tone="good"
          />
          <span
            className={`rounded px-2 py-0.5 font-medium ${ dues.outstandingCents > 0
                ? "bg-warn-soft text-warn"
                : "bg-good-soft text-good"
            }`}
          >
            {dues.outstandingCents > 0 ? "Outstanding" : "All settled"}
          </span>
        </div>
      </div>

      {withCharges.length === 0 ? (
        <p className="rounded-xl border border-good/30 bg-good-soft px-4 py-3 text-sm text-good">
          <span className="font-semibold">
            No late charges this semester.
          </span>{" "}
          You&rsquo;ve been on time to everything.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {withCharges.map((m) => (
            <li key={`${m.year}-${m.month}`}>
              <details className="group rounded-xl border border-line bg-surface">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm marker:content-none">
                  <span className="font-semibold text-ink">
                    {monthLabel(m.month)} {m.year}
                  </span>
                  <span className="tabular-nums text-ink-soft">
                    {formatMoney(m.netCents)}
                  </span>
                  <StatusPill month={m} />
                  <span className="ml-auto text-xs text-ink-faint group-open:hidden">
                    {m.incidents.length}{" "}
                    {m.incidents.length === 1 ? "late arrival" : "late arrivals"}
                  </span>
                </summary>

                <ul className="flex flex-col gap-1.5 border-t border-line px-4 py-3">
                  {m.incidents.map((incident) => (
                    <li
                      key={incident.attendanceId}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
                    >
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${ incident.waivedReason
                            ? "bg-good-soft text-good"
                            : "bg-warn-soft text-warn"
                        }`}
                      >
                        {formatMoney(incident.cents)}
                      </span>
                      <span className="font-medium text-ink">
                        {incident.danceName}
                      </span>
                      <span className="text-ink-soft">
                        {whenLabel(incident.startIso)}
                        {incident.checkedInIso && (
                          <>
                            {" "}
                            &middot; arrived {timeLabel(incident.checkedInIso)} (
                            {incident.minutesLate} min late)
                          </>
                        )}
                      </span>
                      {incident.waivedReason && (
                        <span className="w-full text-xs text-good">
                          Waived by the AD: {incident.waivedReason}
                        </span>
                      )}
                    </li>
                  ))}

                  {m.appliedCents > 0 && (
                    <li className="mt-1 border-t border-line pt-2 text-sm text-good">
                      {formatMoney(-m.appliedCents)} taken off for credits you
                      earned.
                    </li>
                  )}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusPill({
  month,
}: {
  month: { netCents: number; isPaid: boolean; venmoRequested: boolean };
}) {
  if (month.netCents === 0) {
    return (
      <span className="rounded bg-good-soft px-2 py-0.5 text-xs font-medium text-good">
        Nothing owed
      </span>
    );
  }
  if (month.isPaid) {
    return (
      <span className="rounded bg-good-soft px-2 py-0.5 text-xs font-medium text-good">
        Paid
      </span>
    );
  }
  if (month.venmoRequested) {
    return (
      <span className="rounded bg-info-soft px-2 py-0.5 text-xs font-medium text-info">
        Venmo requested
      </span>
    );
  }
  return (
    <span className="rounded bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">
      Unpaid
    </span>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good";
}) {
  return (
    <span className="text-ink-soft">
      {label}{" "}
      <span
        className={`font-semibold tabular-nums ${ tone === "good" ? "text-good" : "text-ink"
        }`}
      >
        {value}
      </span>
    </span>
  );
}

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
});
const clockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

function whenLabel(iso: string): string {
  const d = new Date(iso);
  return `${dayFormatter.format(d)} ${clockFormatter.format(d)}`;
}

function timeLabel(iso: string): string {
  return clockFormatter.format(new Date(iso));
}
