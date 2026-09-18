/** Turning late check-ins into money, and workshop credits into money off.
 *
 * Every number the dues ledger shows comes from here. No database, no React,
 * nothing async — so the arithmetic that decides what forty people owe can be
 * tested exhaustively and read in one sitting.
 *
 * ## Everything is in cents
 *
 * Not dollars. The credits are worth fifty cents, fees are whole dollars, and
 * a column of those summed as floats is the classic way to end up telling
 * somebody they owe $6.999999999999999. Integers can't do that. Dollars exist
 * only at the edges, in `formatMoney` for display and in the spreadsheet
 * export.
 *
 * ## Where the numbers came from
 *
 * The AD's spreadsheet, unchanged: its `reference` tab lists 5 minutes as $1,
 * 10 as $2, 15 as $5 and 30 as $10, and its deductions tabs list leading
 * Pan-Asian time and leading a workshop at a dollar each, attending one at
 * fifty cents. This file is those two tabs, made to add up.
 */

/** One rung of a ladder: from this many minutes late, this many cents. */
export type FeeTier = { fromMinutes: number; cents: number };

/** The ladder the app started with, and what a database with no schedules in
 * it falls back to.
 *
 * The real ladder lives in the database now, so the AD can change it without
 * a deploy. This stays as the thing tests assert against and as the answer
 * when there is nothing configured, so a missing row can never silently make
 * everything free. */
export const DEFAULT_FEE_TIERS: readonly FeeTier[] = [
  { fromMinutes: 5, cents: 100 },
  { fromMinutes: 10, cents: 200 },
  { fromMinutes: 15, cents: 500 },
  { fromMinutes: 30, cents: 1000 },
];

/** What one late arrival costs, in cents, under a given ladder.
 *
 * Null and undefined mean the app never recorded a lateness for that
 * check-in, which is not the same as zero minutes but costs the same. A
 * negative number means they arrived early; that isn't a discount.
 *
 * The ladder is sorted here rather than trusted. It arrives from a database
 * table the AD edits, and a ladder in the wrong order would charge somebody
 * thirty minutes late a dollar without anything looking wrong. */
export function calculateLateFee(
  minutesLate: number | null | undefined,
  tiers: readonly FeeTier[] = DEFAULT_FEE_TIERS,
): number {
  if (minutesLate === null || minutesLate === undefined) return 0;
  if (!Number.isFinite(minutesLate)) return 0;

  let cents = 0;
  let matched = -1;
  for (const tier of tiers) {
    if (minutesLate >= tier.fromMinutes && tier.fromMinutes > matched) {
      matched = tier.fromMinutes;
      cents = tier.cents;
    }
  }
  return cents;
}

/** The lowest rung of a ladder: everything under it is on time and free. */
export function graceMinutes(tiers: readonly FeeTier[] = DEFAULT_FEE_TIERS): number {
  return tiers.reduce(
    (lowest, t) => Math.min(lowest, t.fromMinutes),
    Number.POSITIVE_INFINITY,
  );
}

/* ------------------------------------------------------------------ *
 * Credits
 * ------------------------------------------------------------------ */

/** A thing a dancer can do that earns money off their charges.
 *
 * A row the AD can add to rather than a fixed list, so "helped at auditions"
 * doesn't need a deploy. */
export type CreditCategory = {
  id: string;
  name: string;
  cents: number;
};

/** The three the app ships with, seeded by the migration. Their ids match the
 * enum values they replaced, so credits logged before this change still point
 * at the right thing. */
export const DEFAULT_CREDIT_CATEGORIES: readonly CreditCategory[] = [
  { id: "PAN_ASIAN_TIME", name: "Leading Pan-Asian time", cents: 100 },
  { id: "LEAD_WORKSHOP", name: "Leading a workshop", cents: 100 },
  { id: "ATTEND_WORKSHOP", name: "Attending a workshop", cents: 50 },
];

export function creditsValue(
  counts: Record<string, number>,
  categories: readonly CreditCategory[],
): number {
  let cents = 0;
  for (const category of categories) {
    cents += (counts[category.id] ?? 0) * category.cents;
  }
  return cents;
}

/* ------------------------------------------------------------------ *
 * Semesters
 * ------------------------------------------------------------------ */

export type Season = "FALL" | "SPRING";
export type Term = { season: Season; year: number };

/** Fall is August to December, Spring is January to May.
 *
 * **June and July are in neither**, which is the AD's own boundary and is
 * fine because the troupe doesn't rehearse over the summer. It is worth
 * knowing rather than assuming: a late check-in at a July rehearsal would
 * produce a fee belonging to no semester, so the ledger reports those
 * separately rather than quietly dropping them. */
export function termForMonth(month: number, year: number): Term | null {
  if (month >= 8 && month <= 12) return { season: "FALL", year };
  if (month >= 1 && month <= 5) return { season: "SPRING", year };
  return null;
}

export function termLabel(term: Term): string {
  return `${term.season === "FALL" ? "Fall" : "Spring"} ${term.year}`;
}

/** Parses a label back, so the stored string on a settlement row and the one
 * in a URL can't drift apart. Returns null for anything it doesn't recognise
 * rather than guessing a year. */
export function parseTermLabel(label: string): Term | null {
  const match = /^(Fall|Spring)\s+(\d{4})$/.exec(label.trim());
  if (!match) return null;
  return {
    season: match[1] === "Fall" ? "FALL" : "SPRING",
    year: Number(match[2]),
  };
}

/** Every month in a term, in order, as the ledger's column headings. */
export function monthsInTerm(term: Term): { month: number; year: number }[] {
  const months = term.season === "FALL" ? [8, 9, 10, 11, 12] : [1, 2, 3, 4, 5];
  return months.map((month) => ({ month, year: term.year }));
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function monthLabel(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

/* ------------------------------------------------------------------ *
 * The waterfall
 * ------------------------------------------------------------------ */

export type MonthInput = {
  month: number;
  year: number;
  /** Late charges incurred that month, in cents. */
  grossCents: number;
  /** Credits earned that month, in cents. */
  earnedCents: number;
};

export type MonthRollup = MonthInput & {
  /** Credits spent against this month's charges. */
  appliedCents: number;
  /** What is actually owed after credits: never below zero. */
  netCents: number;
  /** Credits left over and carried into the next month of the same term. */
  bankedAfterCents: number;
};

/** Walks a term's months in order, spending credits as they are earned.
 *
 * Order is the whole point, and it is the part that is easy to get wrong.
 * Credits earned in October cannot pay off a fine from August — August has
 * already been settled by then — so this is a forward walk rather than a
 * subtraction of two totals. Leftovers bank and roll into the next month.
 *
 * **Nothing crosses a term.** A dancer who banked three dollars of workshop
 * credit in the autumn starts the spring at zero. Callers enforce that by
 * only ever passing one term's months in; passing two would silently carry
 * the balance across, so don't.
 *
 * Months are sorted here rather than trusted, because a caller that builds
 * them from a map gets whatever order the keys happened to be in, and that
 * bug would show up as one dancer's credits mysteriously not applying. */
export function runDeductionWaterfall(months: MonthInput[]): MonthRollup[] {
  const ordered = [...months].sort(
    (a, b) => a.year - b.year || a.month - b.month,
  );

  let banked = 0;
  return ordered.map((m) => {
    const available = banked + m.earnedCents;
    const appliedCents = Math.min(m.grossCents, available);
    banked = available - appliedCents;
    return {
      ...m,
      appliedCents,
      netCents: m.grossCents - appliedCents,
      bankedAfterCents: banked,
    };
  });
}

export type TermTotals = {
  grossCents: number;
  earnedCents: number;
  appliedCents: number;
  netCents: number;
  /** Still unspent at the end of the term. It expires there. */
  bankedCents: number;
};

export function totalsForTerm(rollups: MonthRollup[]): TermTotals {
  const sum = (pick: (r: MonthRollup) => number) =>
    rollups.reduce((total, r) => total + pick(r), 0);
  return {
    grossCents: sum((r) => r.grossCents),
    earnedCents: sum((r) => r.earnedCents),
    appliedCents: sum((r) => r.appliedCents),
    netCents: sum((r) => r.netCents),
    bankedCents: rollups.length ? rollups[rollups.length - 1].bankedAfterCents : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

/** "$6.00", or "-$1.50" for a credit. Always two decimal places: a column of
 * dues where some rows say $6 and others $6.50 is hard to scan. */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Dollars, for the spreadsheet export, where a number has to stay a number
 * so the AD can sum a column themselves. */
export function toDollars(cents: number): number {
  return Math.round(cents) / 100;
}
