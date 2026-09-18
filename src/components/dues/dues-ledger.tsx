import Link from "next/link";
import { auth } from "@/auth";
import {
  currentTerm,
  getCreditLedger,
  getMonthlyDuesLedger,
  getRateSettings,
  getTermSummary,
  type MonthlyLedger,
} from "@/lib/actions/dues";
import {
  formatMoney,
  monthLabel,
  monthsInTerm,
  parseTermLabel,
  termLabel,
  type Term,
} from "@/lib/attendance-fees";
import { APP_TIME_ZONE } from "@/lib/timezone";
import { SettlementToggle } from "@/components/dues/settlement-toggles";
import { CreditStepper } from "@/components/dues/credit-stepper";
import { ChargeRow } from "@/components/dues/charge-controls";
import { RateSettingsPanel } from "@/components/dues/rate-settings";

/** Late charges: what people owe, and whether it came in.
 *
 * Sub-tabs rather than one screen, because this is a lot of numbers and the
 * jobs are genuinely different: chasing one month's payments, reporting on a
 * semester, logging credits at a club meeting, and setting the rates. Putting
 * them on one page produced exactly the wall of figures the spreadsheet was.
 *
 * Open to the AD and to whoever holds the dues ledger flag, and to nobody
 * else. Settings and corrections are the AD's alone — the treasurer chases
 * payments, and deciding a payment isn't owed is a different job.
 *
 * It lives at /dues rather than under /admin on purpose. The admin layout
 * redirects every non-admin at the door, which is exactly the guarantee you
 * want it to keep — so the treasurer could never reach a page underneath it,
 * and the alternative was to weaken that check for every admin page to let
 * one person at one of them. One route, one guard, and /admin stays as strict
 * as it was. The AD reaches it from a tab in the admin nav all the same. */
export async function DuesLedger({
  basePath,
  params,
}: {
  /** Where this is mounted. The AD reaches it inside the admin console and
   * the treasurer reaches it inside the dancer app, so every link this page
   * builds has to come back to whichever shell it was opened in. */
  basePath: string;
  params: { tab?: string; month?: string; term?: string };
}) {
  const { tab, month, term: termParam } = params;
  const session = await auth();
  const isAdmin = session?.user?.isAdmin === true;

  const term = parseTermLabel(termParam ?? "") ?? (await currentTerm());
  const months = monthsInTerm(term);

  const asked = tab ?? "ledger";
  const active =
    asked === "summary" || asked === "credits"
      ? asked
      : // A treasurer who lands on a bookmarked Settings link gets the ledger
        // rather than an error, because the tab simply isn't theirs.
        asked === "settings" && isAdmin
        ? "settings"
        : "ledger";
  const picked = Number(month);
  const selected =
    months.find((m) => m.month === picked) ?? months[currentMonthIndex(months)];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">Late charges</h1>
        <p className="max-w-2xl text-sm text-ink-soft">
          Charges work themselves out from check-ins. Nothing here is typed in
          by hand except who has paid and what people earned back.
        </p>
      </header>

      <TermSwitcher basePath={basePath} term={term} tab={active} />

      <nav className="flex flex-wrap gap-1 border-b border-line">
        <SubTab
          href={link(basePath, term, "ledger", selected.month)}
          active={active === "ledger"}
        >
          Monthly ledger
        </SubTab>
        <SubTab href={link(basePath, term, "summary")} active={active === "summary"}>
          Semester summary
        </SubTab>
        <SubTab href={link(basePath, term, "credits")} active={active === "credits"}>
          Credits &amp; workshops
        </SubTab>
        {isAdmin && (
          <SubTab
            href={link(basePath, term, "settings")}
            active={active === "settings"}
          >
            Rates &amp; credits
          </SubTab>
        )}
      </nav>

      {active === "ledger" && (
        <MonthlyLedgerTab
          basePath={basePath}
          term={term}
          month={selected.month}
          year={selected.year}
          isAdmin={isAdmin}
        />
      )}
      {active === "summary" && <SummaryTab term={term} />}
      {active === "credits" && <CreditsTab term={term} />}
      {active === "settings" && <SettingsTab />}
    </div>
  );
}

function currentMonthIndex(months: { month: number }[]): number {
  const now = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, month: "numeric" })
      .format(new Date()),
  );
  const at = months.findIndex((m) => m.month === now);
  return at >= 0 ? at : 0;
}

function link(
  basePath: string,
  term: Term,
  tab: string,
  month?: number,
): string {
  const params = new URLSearchParams({ term: termLabel(term), tab });
  if (month) params.set("month", String(month));
  return `${basePath}?${params}`;
}

function SubTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${ active
          ? "border-accent text-accent-ink"
          : "border-transparent text-ink-soft hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function TermSwitcher({
  basePath,
  term,
  tab,
}: {
  basePath: string;
  term: Term;
  tab: string;
}) {
  const other: Term =
    term.season === "FALL"
      ? { season: "SPRING", year: term.year + 1 }
      : { season: "FALL", year: term.year - 1 };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium text-ink">{termLabel(term)}</span>
      <Link
        href={link(basePath, other, tab)}
        className="rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent-ink"
      >
        Switch to {termLabel(other)}
      </Link>
      <span className="text-xs text-ink-faint">
        Credits never carry across a semester.
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sub-tab 1: the month
 * ------------------------------------------------------------------ */

async function MonthlyLedgerTab({
  basePath,
  term,
  month,
  year,
  isAdmin,
}: {
  basePath: string;
  term: Term;
  month: number;
  year: number;
  isAdmin: boolean;
}) {
  const ledger = await getMonthlyDuesLedger(month, year);
  const months = monthsInTerm(term);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1">
        {months.map((m) => (
          <Link
            key={m.month}
            href={link(basePath, term, "ledger", m.month)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${ m.month === month
                ? "bg-accent text-on-accent"
                : "text-ink-soft hover:bg-surface-3 hover:text-ink"
            }`}
          >
            {monthLabel(m.month)}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Charges this month" value={formatMoney(ledger.totals.grossCents)} />
        <Kpi
          label="Credits absorbed"
          value={formatMoney(-ledger.totals.appliedCents)}
          tone="good"
        />
        <Kpi
          label="Owed"
          value={formatMoney(ledger.totals.netCents)}
          tone="accent"
        />
        <Kpi
          label="Settled"
          value={
            ledger.totals.memberCount === 0
              ? "Nobody owes anything"
              : `${ledger.totals.settledCount} of ${ledger.totals.memberCount}`
          }
        />
      </div>

      {ledger.rows.every((r) => r.incidents.length === 0) ? (
        <p className="rounded-xl border border-good/30 bg-good-soft px-4 py-3 text-sm text-good">
          <span className="font-semibold">
            Nobody was late in {monthLabel(month)}.
          </span>{" "}
          Nothing to collect.
        </p>
      ) : (
        <ChargesTable ledger={ledger} isAdmin={isAdmin} />
      )}

      <SettlementTable ledger={ledger} month={month} year={year} />

      <FeeLadderNote tiers={ledger.tiers} />
    </div>
  );
}

/** Every charge in the month, one to a line.
 *
 * A line per charge rather than a card per person, because the question this
 * table answers is "why is this person being charged $7" and the answer is
 * four rows with dates on them. The person's name appears once at the top of
 * their block, the way a spreadsheet leaves a merged cell blank underneath. */
function ChargesTable({
  ledger,
  isAdmin,
}: {
  ledger: MonthlyLedger;
  isAdmin: boolean;
}) {
  const COLUMNS = 7;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-ink">Every late arrival</h2>
      <Scroller>
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line-strong">
              <Th sticky>Dancer</Th>
              <Th>When</Th>
              <Th>Dance</Th>
              <Th numeric>Min late</Th>
              <Th>Checked in</Th>
              <Th numeric>Charge</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {ledger.rows
              .filter((r) => r.incidents.length > 0)
              .map((row) =>
                row.incidents.map((incident, i) => (
                  <ChargeRow
                    key={incident.attendanceId}
                    columns={COLUMNS}
                    canEdit={isAdmin}
                    cells={{
                      attendanceId: incident.attendanceId,
                      practiceId: incident.practiceId,
                      dancerName: i === 0 ? row.name : null,
                      when: whenLabel(incident.startIso),
                      danceName: incident.danceName,
                      arrived: incident.checkedInIso
                        ? timeLabel(incident.checkedInIso)
                        : null,
                      minutesLate: incident.minutesLate,
                      cents: incident.cents,
                      fullCents: incident.fullCents,
                      waivedReason: incident.waivedReason,
                    }}
                  />
                )),
              )}
          </tbody>
        </table>
      </Scroller>
    </section>
  );
}

/** What each person owes for the month, and the two ticks. */
function SettlementTable({
  ledger,
  month,
  year,
}: {
  ledger: MonthlyLedger;
  month: number;
  year: number;
}) {
  const rows = ledger.rows.filter(
    (r) => r.incidents.length > 0 || r.netCents > 0 || r.bankedAfterCents > 0,
  );
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-ink">
        What each person owes for {monthLabel(month)}
      </h2>
      <Scroller>
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line-strong">
              <Th sticky>Dancer</Th>
              <Th numeric>Charges</Th>
              <Th numeric>Credits</Th>
              <Th numeric>Owed</Th>
              <Th numeric>Banked</Th>
              <Th>Venmo requested</Th>
              <Th>Paid</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId} className="border-b border-line">
                <Td sticky>{row.name}</Td>
                <Td numeric muted={!row.grossCents}>
                  {formatMoney(row.grossCents)}
                </Td>
                <Td numeric muted={!row.appliedCents}>
                  {formatMoney(-row.appliedCents)}
                </Td>
                <Td numeric strong={row.netCents > 0} muted={!row.netCents}>
                  {formatMoney(row.netCents)}
                </Td>
                <Td numeric muted={!row.bankedAfterCents}>
                  {formatMoney(row.bankedAfterCents)}
                </Td>
                <Td>
                  <SettlementToggle
                    userId={row.userId}
                    month={month}
                    year={year}
                    field="venmoRequested"
                    value={row.venmoRequested}
                    label=""
                    disabled={row.netCents === 0}
                  />
                </Td>
                <Td>
                  <SettlementToggle
                    userId={row.userId}
                    month={month}
                    year={year}
                    field="isPaid"
                    value={row.isPaid}
                    label=""
                    disabled={row.netCents === 0}
                  />
                </Td>
              </tr>
            ))}
            <tr className="bg-surface-2">
              <Td sticky strong>
                Total
              </Td>
              <Td numeric strong>
                {formatMoney(ledger.totals.grossCents)}
              </Td>
              <Td numeric strong>
                {formatMoney(-ledger.totals.appliedCents)}
              </Td>
              <Td numeric strong>
                {formatMoney(ledger.totals.netCents)}
              </Td>
              <Td />
              <Td />
              <Td numeric muted>
                {ledger.totals.memberCount === 0
                  ? "—"
                  : `${ledger.totals.settledCount}/${ledger.totals.memberCount}`}
              </Td>
            </tr>
          </tbody>
        </table>
      </Scroller>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Sub-tab 2: the semester
 * ------------------------------------------------------------------ */

async function SummaryTab({ term }: { term: Term }) {
  const summary = await getTermSummary(termLabel(term));
  const key = (m: { month: number; year: number }) => `${m.year}-${m.month}`;
  const r = summary.reconciliation;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            Every dancer&rsquo;s semester
          </h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            Charges by month, then what is still out. Anyone who was never late
            and earned nothing is left off.
          </p>
        </div>
        <a
          href={`/dues/export?term=${encodeURIComponent(termLabel(term))}`}
          className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent-ink"
        >
          Export to spreadsheet
        </a>
      </div>

      {summary.dancers.length === 0 ? (
        <p className="text-sm text-ink-soft">
          No late arrivals recorded this semester.
        </p>
      ) : (
        <Scroller>
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line-strong">
                <Th sticky>Dancer</Th>
                {summary.months.map((m) => (
                  <Th key={key(m)} numeric>
                    {monthLabel(m.month)}
                  </Th>
                ))}
                <Th numeric>Charges</Th>
                <Th numeric>Credits</Th>
                <Th numeric>Owed</Th>
                <Th numeric>Paid</Th>
                <Th numeric>Still out</Th>
              </tr>
            </thead>
            <tbody>
              {summary.dancers.map((d) => (
                <tr key={d.userId} className="border-b border-line">
                  <Td sticky>{d.name}</Td>
                  {summary.months.map((m) => (
                    <Td key={key(m)} numeric muted={!d.byMonth[key(m)]}>
                      {formatMoney(d.byMonth[key(m)] ?? 0)}
                    </Td>
                  ))}
                  <Td numeric>{formatMoney(d.grossCents)}</Td>
                  <Td numeric muted={!d.appliedCents}>
                    {formatMoney(-d.appliedCents)}
                  </Td>
                  <Td numeric strong>
                    {formatMoney(d.netCents)}
                  </Td>
                  <Td numeric muted={!d.collectedCents}>
                    {formatMoney(d.collectedCents)}
                  </Td>
                  <Td
                    numeric
                    strong={d.outstandingCents > 0}
                    muted={!d.outstandingCents}
                  >
                    {formatMoney(d.outstandingCents)}
                  </Td>
                </tr>
              ))}
              <tr className="bg-surface-2">
                <Td sticky strong>
                  Everyone
                </Td>
                {summary.months.map((m) => (
                  <Td key={key(m)} numeric strong>
                    {formatMoney(r.grossByMonth[key(m)] ?? 0)}
                  </Td>
                ))}
                <Td numeric strong>
                  {formatMoney(r.totals.grossCents)}
                </Td>
                <Td numeric strong>
                  {formatMoney(-r.totals.appliedCents)}
                </Td>
                <Td numeric strong>
                  {formatMoney(r.totals.netCents)}
                </Td>
                <Td numeric strong>
                  {formatMoney(r.totals.collectedCents)}
                </Td>
                <Td numeric strong>
                  {formatMoney(r.totals.outstandingCents)}
                </Td>
              </tr>
            </tbody>
          </table>
        </Scroller>
      )}

      <h2 className="text-sm font-semibold text-ink">The money, month by month</h2>
      <Scroller>
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line-strong">
              <Th sticky />
              {summary.months.map((m) => (
                <Th key={key(m)} numeric>
                  {monthLabel(m.month)}
                </Th>
              ))}
              <Th numeric>Semester</Th>
            </tr>
          </thead>
          <tbody>
            <ReconRow
              label="Charges"
              months={summary.months}
              values={r.grossByMonth}
              total={r.totals.grossCents}
            />
            <ReconRow
              label="Credits applied"
              months={summary.months}
              values={r.appliedByMonth}
              total={r.totals.appliedCents}
              negative
            />
            <ReconRow
              label="Owed"
              months={summary.months}
              values={r.netByMonth}
              total={r.totals.netCents}
              strong
            />
            <ReconRow
              label="Collected"
              months={summary.months}
              values={r.collectedByMonth}
              total={r.totals.collectedCents}
            />
            <ReconRow
              label="Still outstanding"
              months={summary.months}
              values={r.outstandingByMonth}
              total={r.totals.outstandingCents}
              strong
            />
          </tbody>
        </table>
      </Scroller>
    </div>
  );
}

function ReconRow({
  label,
  months,
  values,
  total,
  negative,
  strong,
}: {
  label: string;
  months: { month: number; year: number }[];
  values: Record<string, number>;
  total: number;
  negative?: boolean;
  strong?: boolean;
}) {
  const show = (cents: number) => formatMoney(negative ? -cents : cents);
  return (
    <tr className={`border-b border-line ${strong ? "bg-surface-2" : ""}`}>
      <Td sticky strong={strong}>
        {label}
      </Td>
      {months.map((m) => {
        const cents = values[`${m.year}-${m.month}`] ?? 0;
        return (
          <Td key={`${m.year}-${m.month}`} numeric strong={strong} muted={!cents}>
            {show(cents)}
          </Td>
        );
      })}
      <Td numeric strong>
        {show(total)}
      </Td>
    </tr>
  );
}

/* ------------------------------------------------------------------ *
 * Sub-tab 3: credits
 * ------------------------------------------------------------------ */

async function CreditsTab({ term }: { term: Term }) {
  const { categories, rows } = await getCreditLedger(termLabel(term));
  const label = termLabel(term);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-ink-soft">
        Tap plus as you go through a meeting. Each one comes straight off what
        that person owes, oldest charges first, and anything left over rolls
        into the next month of this semester.
      </p>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-soft">
        {categories.map((category) => (
          <span key={category.id}>
            <span className="font-medium text-ink">{category.name}</span>{" "}
            {formatMoney(-category.cents)}
          </span>
        ))}
      </div>

      <Scroller>
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line-strong">
              <Th sticky>Dancer</Th>
              {categories.map((category) => (
                <Th key={category.id}>{category.name}</Th>
              ))}
              <Th numeric>Earned</Th>
              <Th numeric>Used</Th>
              <Th numeric>Banked</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId} className="border-b border-line">
                <Td sticky>{row.name}</Td>
                {categories.map((category) => (
                  <Td key={category.id}>
                    <CreditStepper
                      userId={row.userId}
                      categoryId={category.id}
                      term={label}
                      count={row.counts[category.id] ?? 0}
                      readOnly={category.name.endsWith("(retired)")}
                    />
                  </Td>
                ))}
                <Td numeric muted={!row.earnedCents}>
                  {formatMoney(-row.earnedCents)}
                </Td>
                <Td numeric muted={!row.usedCents}>
                  {formatMoney(-row.usedCents)}
                </Td>
                <Td numeric strong={row.bankedCents > 0} muted={!row.bankedCents}>
                  {formatMoney(row.bankedCents)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroller>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sub-tab 4: the rates
 * ------------------------------------------------------------------ */

async function SettingsTab() {
  const settings = await getRateSettings();
  return <RateSettingsPanel settings={settings} />;
}

/* ------------------------------------------------------------------ *
 * Bits
 * ------------------------------------------------------------------ */

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "accent";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-xs font-medium text-ink-soft">{label}</div>
      <div
        className={`mt-0.5 text-xl font-semibold tabular-nums ${ tone === "good"
            ? "text-good"
            : tone === "accent"
              ? "text-accent-ink"
              : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function FeeLadderNote({
  tiers,
}: {
  tiers: { fromMinutes: number; cents: number }[];
}) {
  if (tiers.length === 0) return null;
  return (
    <p className="text-xs text-ink-faint">
      Under {tiers[0].fromMinutes} minutes is free.{" "}
      {tiers.map((t) => `${t.fromMinutes} min ${formatMoney(t.cents)}`).join(" · ")}
      . Somebody who agreed in advance to arrive late is measured from the time
      they agreed, so they are not charged for keeping to it.
    </p>
  );
}

function Scroller({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

function Th({
  children,
  numeric,
  sticky,
}: {
  children?: React.ReactNode;
  numeric?: boolean;
  sticky?: boolean;
}) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-faint ${ numeric ? "text-right" : "text-left"
      } ${sticky ? "sticky left-0 bg-canvas" : ""}`}
    >
      {children}
    </th>
  );
}

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
      className={`whitespace-nowrap px-3 py-2 ${ numeric ? "text-right tabular-nums" : ""
      } ${sticky ? "sticky left-0 bg-canvas font-medium" : ""} ${ strong ? "font-semibold text-ink" : muted ? "text-ink-faint" : "text-ink-soft"
      }`}
    >
      {children}
    </td>
  );
}

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  month: "numeric",
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
