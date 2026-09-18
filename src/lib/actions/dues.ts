"use server";

/** Everything the dues ledger reads and writes.
 *
 * The money itself is worked out in `src/lib/attendance-fees.ts`, which knows
 * nothing about a database. This file is the part that fetches rows and hands
 * them to it, so the arithmetic stays testable and the queries stay in one
 * place.
 *
 * **Nothing here stores a total.** What somebody owes is derived from their
 * attendance records and their credits every time it is asked for. The
 * spreadsheet this replaces stored its totals in cells next to the numbers
 * they totalled, and they drifted until half of them read #REF!. The only
 * figure written down is what was actually collected when a month was marked
 * paid, which is a receipt rather than a total. */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireFinance, requireUser } from "@/lib/authz";
import { parseAppDateTime, zonedParts } from "@/lib/timezone";
import {
  calculateLateFee,
  DEFAULT_CREDIT_CATEGORIES,
  DEFAULT_FEE_TIERS,
  monthsInTerm,
  parseTermLabel,
  runDeductionWaterfall,
  termForMonth,
  termLabel,
  totalsForTerm,
  type CreditCategory,
  type FeeTier,
  type MonthRollup,
  type Term,
  type TermTotals,
} from "@/lib/attendance-fees";

/** Nothing before this is ever charged.
 *
 * The app has been recording check-ins since well before anyone agreed to pay
 * for being late, and switching the ledger on shouldn't hand forty people a
 * bill for rehearsals they'd long forgotten. So charges begin at the start of
 * the semester this shipped in, and everything earlier is invisible to it.
 *
 * Deliberately a constant rather than a setting. There is exactly one right
 * answer and it never changes again; a box in Settings would only be a way to
 * get it wrong later. */
const DUES_START = "2026-08-01";

function monthBounds(month: number, year: number): { start: Date; end: Date } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = parseAppDateTime(`${year}-${pad(month)}-01`);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return { start, end: parseAppDateTime(`${nextYear}-${pad(nextMonth)}-01`) };
}

function duesStart(): Date {
  return parseAppDateTime(DUES_START);
}

/** The term the app should open on: whichever one today falls in, and the
 * most recent one if today is in the summer gap. */
export async function currentTerm(): Promise<Term> {
  const here = zonedParts(new Date());
  return (
    termForMonth(here.month, here.year) ?? { season: "FALL", year: here.year }
  );
}

/** Every fee ladder the club has ever had, newest first.
 *
 * A charge is priced with whichever was in force on the day of the practice,
 * so raising the rates in October leaves September's charges exactly as
 * people were told them. Fetched once per request and reused, because pricing
 * one month means pricing a few hundred incidents. */
async function feeSchedules(): Promise<
  { effectiveFrom: Date; tiers: FeeTier[] }[]
> {
  const rows = await prisma.feeSchedule.findMany({
    orderBy: { effectiveFrom: "desc" },
    select: {
      effectiveFrom: true,
      tiers: { select: { fromMinutes: true, cents: true } },
    },
  });
  if (rows.length === 0) {
    // Nothing configured at all. Falling back to the shipped ladder rather
    // than to nothing, because "every charge is suddenly zero" is a far worse
    // failure than "the rates are the ones we started with".
    return [{ effectiveFrom: new Date(0), tiers: [...DEFAULT_FEE_TIERS] }];
  }
  return rows;
}

function tiersOn(
  schedules: { effectiveFrom: Date; tiers: FeeTier[] }[],
  when: Date,
): FeeTier[] {
  const inForce = schedules.find((s) => s.effectiveFrom <= when);
  // A practice older than every schedule keeps the oldest one rather than
  // becoming free.
  return (inForce ?? schedules[schedules.length - 1]).tiers;
}

/** The credit categories, including retired ones.
 *
 * Archived categories still have to resolve: a credit earned last term
 * against a category the AD has since removed is still worth what it was
 * worth, and must not silently become zero. */
export async function creditCategories(
  includeArchived = false,
): Promise<CreditCategory[]> {
  const rows = await prisma.creditCategory.findMany({
    where: includeArchived ? {} : { archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, cents: true },
  });
  return rows.length > 0 ? rows : [...DEFAULT_CREDIT_CATEGORIES];
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export type LateIncident = {
  attendanceId: string;
  /** So the ledger can link straight to the sheet where it gets corrected. */
  practiceId: string;
  danceName: string;
  /** ISO, for formatting in the client against Eastern. */
  startIso: string;
  checkedInIso: string | null;
  minutesLate: number;
  /** What is actually charged: zero if waived. */
  cents: number;
  /** What the ladder says it would cost, waiver or not, so the AD can see
   * what was written off rather than just that something was. */
  fullCents: number;
  waivedReason: string | null;
};

export type LedgerRow = {
  userId: string;
  name: string;
  incidents: LateIncident[];
  grossCents: number;
  /** Credits spent against this month, after the earlier months of the term
   * have taken theirs. */
  appliedCents: number;
  netCents: number;
  bankedAfterCents: number;
  venmoRequested: boolean;
  isPaid: boolean;
};

export type MonthlyLedger = {
  month: number;
  year: number;
  term: string;
  rows: LedgerRow[];
  /** The ladder pricing this month, so the screen can explain the charges it
   * is showing rather than the ones it shipped with. */
  tiers: FeeTier[];
  totals: {
    grossCents: number;
    appliedCents: number;
    netCents: number;
    settledCount: number;
    memberCount: number;
  };
};

/** Every late arrival in one month, priced, with the credits of the term so
 * far already spent against the earlier months.
 *
 * The credits part is why this reads the whole term rather than just the
 * month: a dancer's October credits depend on what August and September
 * already used up, and asking for one month in isolation would apply the same
 * credit twice. */
export async function getMonthlyDuesLedger(
  month: number,
  year: number,
): Promise<MonthlyLedger> {
  await requireFinance();

  const term = termForMonth(month, year);
  if (!term) {
    throw new Error(
      `${month}/${year} is outside the Fall and Spring terms, so it has no ledger.`,
    );
  }
  const label = termLabel(term);

  const [roster, byMonth, credits, settlements, schedules] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    incidentsByMonth(term),
    creditsByMonth(label),
    prisma.monthlyDuesSettlement.findMany({
      where: { month, year },
      select: { userId: true, venmoRequested: true, isPaid: true },
    }),
    feeSchedules(),
  ]);

  const settlementFor = new Map(settlements.map((s) => [s.userId, s]));

  const rows: LedgerRow[] = roster.map((person) => {
    const walk = waterfallFor(person.id, term, byMonth, credits);
    const here = walk.find((m) => m.month === month && m.year === year);
    const settled = settlementFor.get(person.id);

    return {
      userId: person.id,
      name: person.name ?? person.email,
      incidents: byMonth.get(monthKey(month, year))?.get(person.id) ?? [],
      grossCents: here?.grossCents ?? 0,
      appliedCents: here?.appliedCents ?? 0,
      netCents: here?.netCents ?? 0,
      bankedAfterCents: here?.bankedAfterCents ?? 0,
      venmoRequested: settled?.venmoRequested ?? false,
      isPaid: settled?.isPaid ?? false,
    };
  });

  // Only people who actually owe something count toward "settled", because a
  // ratio of 36 that silently includes 30 people who owe nothing tells the AD
  // nothing about who still has to pay.
  const owing = rows.filter((r) => r.netCents > 0);

  return {
    month,
    year,
    term: label,
    rows,
    tiers: [...tiersOn(schedules, monthBounds(month, year).start)].sort(
      (a, b) => a.fromMinutes - b.fromMinutes,
    ),
    totals: {
      grossCents: rows.reduce((t, r) => t + r.grossCents, 0),
      appliedCents: rows.reduce((t, r) => t + r.appliedCents, 0),
      netCents: rows.reduce((t, r) => t + r.netCents, 0),
      settledCount: owing.filter((r) => r.isPaid).length,
      memberCount: owing.length,
    },
  };
}

function monthKey(month: number, year: number): string {
  return `${year}-${month}`;
}

/** Every chargeable late arrival in a term, bucketed by month and person. */
async function incidentsByMonth(
  term: Term,
): Promise<Map<string, Map<string, LateIncident[]>>> {
  const months = monthsInTerm(term);
  const start = monthBounds(months[0].month, months[0].year).start;
  const end = monthBounds(
    months[months.length - 1].month,
    months[months.length - 1].year,
  ).end;

  const floor = duesStart();
  const from = start > floor ? start : floor;

  const [rows, schedules] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        // Absence is an attendance matter, not a money one: somebody who
        // never turned up has no lateness recorded and owes nothing here.
        // The threshold is 1 rather than the grace minutes, because the grace
        // threshold now comes from a ladder the AD can change and a query
        // can't know which ladder applies before it has the practice date.
        minutesLate: { gte: 1 },
        practice: {
          status: "CONFIRMED",
          startDateTime: { gte: from, lt: end },
        },
      },
      select: {
        id: true,
        userId: true,
        minutesLate: true,
        checkedInAt: true,
        waiver: { select: { reason: true } },
        practice: {
          select: {
            id: true,
            startDateTime: true,
            dance: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { practice: { startDateTime: "asc" } },
    }),
    feeSchedules(),
  ]);

  const out = new Map<string, Map<string, LateIncident[]>>();
  for (const row of rows) {
    const when = zonedParts(row.practice.startDateTime);
    const key = monthKey(when.month, when.year);
    const forMonth = out.get(key) ?? new Map<string, LateIncident[]>();
    const forPerson = forMonth.get(row.userId) ?? [];
    const full = calculateLateFee(
      row.minutesLate,
      tiersOn(schedules, row.practice.startDateTime),
    );
    // Below the grace threshold there is no charge at all, so there is
    // nothing to show. Keeping these would fill the ledger with rows saying
    // "3 min, $0" that nobody needs to read.
    if (full === 0 && !row.waiver) continue;

    forPerson.push({
      attendanceId: row.id,
      practiceId: row.practice.id,
      danceName: row.practice.dance.name,
      startIso: row.practice.startDateTime.toISOString(),
      checkedInIso: row.checkedInAt?.toISOString() ?? null,
      minutesLate: row.minutesLate ?? 0,
      cents: row.waiver ? 0 : full,
      fullCents: full,
      waivedReason: row.waiver?.reason ?? null,
    });
    forMonth.set(row.userId, forPerson);
    out.set(key, forMonth);
  }
  return out;
}

/** Credits earned in a term, bucketed by month and person. */
async function creditsByMonth(
  term: string,
): Promise<Map<string, Map<string, number>>> {
  const rows = await prisma.attendanceCredit.findMany({
    where: { term },
    select: { userId: true, cents: true, occurredOn: true },
  });

  const out = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const when = zonedParts(row.occurredOn);
    const key = monthKey(when.month, when.year);
    const forMonth = out.get(key) ?? new Map<string, number>();
    forMonth.set(row.userId, (forMonth.get(row.userId) ?? 0) + row.cents);
    out.set(key, forMonth);
  }
  return out;
}

function waterfallFor(
  userId: string,
  term: Term,
  incidents: Map<string, Map<string, LateIncident[]>>,
  credits: Map<string, Map<string, number>>,
): MonthRollup[] {
  return runDeductionWaterfall(
    monthsInTerm(term).map(({ month, year }) => {
      const key = monthKey(month, year);
      const mine = incidents.get(key)?.get(userId) ?? [];
      return {
        month,
        year,
        grossCents: mine.reduce((t, i) => t + i.cents, 0),
        earnedCents: credits.get(key)?.get(userId) ?? 0,
      };
    }),
  );
}

export type DancerMonthTotals = {
  userId: string;
  name: string;
  /** Charges by month key, before credits. */
  byMonth: Record<string, number>;
  grossCents: number;
  appliedCents: number;
  netCents: number;
  /** Of what they owe, how much has been ticked paid. */
  collectedCents: number;
  outstandingCents: number;
};

export type TermSummary = {
  term: string;
  months: { month: number; year: number }[];
  /** One row per person, because these are the people being charged.
   *
   * It was by dance to begin with, which answered a question nobody was
   * asking: the AD never chases a dance for five dollars. */
  dancers: DancerMonthTotals[];
  /** The bottom reconciliation block, one figure per month plus a term total. */
  reconciliation: {
    grossByMonth: Record<string, number>;
    appliedByMonth: Record<string, number>;
    netByMonth: Record<string, number>;
    collectedByMonth: Record<string, number>;
    outstandingByMonth: Record<string, number>;
    totals: TermTotals & { collectedCents: number; outstandingCents: number };
  };
};

/** The semester view: who ran up the charges, and whether the money came in. */
export async function getTermSummary(termLabelInput: string): Promise<TermSummary> {
  await requireFinance();

  const term = parseTermLabel(termLabelInput);
  if (!term) throw new Error(`"${termLabelInput}" is not a term.`);
  const label = termLabel(term);
  const months = monthsInTerm(term);

  const [incidents, credits, roster, settlements] = await Promise.all([
    incidentsByMonth(term),
    creditsByMonth(label),
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    prisma.monthlyDuesSettlement.findMany({
      where: { term: label },
      select: { userId: true, month: true, year: true, isPaid: true },
    }),
  ]);

  const paid = new Set(
    settlements.filter((s) => s.isPaid).map((s) => `${s.userId}:${s.month}:${s.year}`),
  );

  const grossByMonth: Record<string, number> = {};
  const appliedByMonth: Record<string, number> = {};
  const netByMonth: Record<string, number> = {};
  const collectedByMonth: Record<string, number> = {};
  const outstandingByMonth: Record<string, number> = {};
  for (const { month, year } of months) {
    const key = monthKey(month, year);
    grossByMonth[key] = 0;
    appliedByMonth[key] = 0;
    netByMonth[key] = 0;
    collectedByMonth[key] = 0;
    outstandingByMonth[key] = 0;
  }

  let grand: TermTotals = {
    grossCents: 0,
    earnedCents: 0,
    appliedCents: 0,
    netCents: 0,
    bankedCents: 0,
  };
  let collectedCents = 0;

  const dancers: DancerMonthTotals[] = [];

  for (const person of roster) {
    const walk = waterfallFor(person.id, term, incidents, credits);
    const totals = totalsForTerm(walk);
    grand = {
      grossCents: grand.grossCents + totals.grossCents,
      earnedCents: grand.earnedCents + totals.earnedCents,
      appliedCents: grand.appliedCents + totals.appliedCents,
      netCents: grand.netCents + totals.netCents,
      bankedCents: grand.bankedCents + totals.bankedCents,
    };

    const byMonth: Record<string, number> = {};
    let mineCollected = 0;
    for (const m of walk) {
      const key = monthKey(m.month, m.year);
      byMonth[key] = m.grossCents;
      grossByMonth[key] += m.grossCents;
      appliedByMonth[key] += m.appliedCents;
      netByMonth[key] += m.netCents;
      if (paid.has(`${person.id}:${m.month}:${m.year}`)) {
        collectedByMonth[key] += m.netCents;
        collectedCents += m.netCents;
        mineCollected += m.netCents;
      } else {
        outstandingByMonth[key] += m.netCents;
      }
    }

    // Somebody who was never late and earned nothing is not a row. Forty of
    // those is what made the spreadsheet unreadable.
    if (totals.grossCents === 0 && totals.earnedCents === 0) continue;

    dancers.push({
      userId: person.id,
      name: person.name ?? person.email,
      byMonth,
      grossCents: totals.grossCents,
      appliedCents: totals.appliedCents,
      netCents: totals.netCents,
      collectedCents: mineCollected,
      outstandingCents: totals.netCents - mineCollected,
    });
  }

  dancers.sort(
    (a, b) =>
      b.outstandingCents - a.outstandingCents ||
      b.grossCents - a.grossCents ||
      a.name.localeCompare(b.name),
  );

  return {
    term: label,
    months,
    dancers,
    reconciliation: {
      grossByMonth,
      appliedByMonth,
      netByMonth,
      collectedByMonth,
      outstandingByMonth,
      totals: {
        ...grand,
        collectedCents,
        outstandingCents: grand.netCents - collectedCents,
      },
    },
  };
}

export type CreditRow = {
  userId: string;
  name: string;
  /** Keyed by category id. A category the AD has since retired can still show
   * a count here, which is why the ledger carries the categories alongside
   * rather than letting the client assume the three it shipped with. */
  counts: Record<string, number>;
  earnedCents: number;
  usedCents: number;
  bankedCents: number;
};

export type CreditLedger = {
  categories: CreditCategory[];
  rows: CreditRow[];
};

export async function getCreditLedger(
  termLabelInput: string,
): Promise<CreditLedger> {
  await requireFinance();
  const term = parseTermLabel(termLabelInput);
  if (!term) throw new Error(`"${termLabelInput}" is not a term.`);
  const label = termLabel(term);

  const [roster, rows, incidents, credits, categories] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    prisma.attendanceCredit.findMany({
      where: { term: label },
      select: { userId: true, categoryId: true },
    }),
    incidentsByMonth(term),
    creditsByMonth(label),
    creditCategories(),
  ]);

  const countsFor = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const c = countsFor.get(row.userId) ?? {};
    c[row.categoryId] = (c[row.categoryId] ?? 0) + 1;
    countsFor.set(row.userId, c);
  }

  // A category that has been retired but still has credits logged against it
  // this term has to stay on screen, or the row's counts add up to less than
  // the money beside them and the AD is left looking for the difference.
  const shown = new Map(categories.map((c) => [c.id, c]));
  const missing = [...new Set(rows.map((r) => r.categoryId))].filter(
    (id) => !shown.has(id),
  );
  if (missing.length > 0) {
    const retired = await prisma.creditCategory.findMany({
      where: { id: { in: missing } },
      select: { id: true, name: true, cents: true },
    });
    for (const c of retired) shown.set(c.id, { ...c, name: `${c.name} (retired)` });
  }

  return {
    categories: [...shown.values()],
    rows: roster.map((person) => {
      const totals = totalsForTerm(waterfallFor(person.id, term, incidents, credits));
      return {
        userId: person.id,
        name: person.name ?? person.email,
        counts: countsFor.get(person.id) ?? {},
        earnedCents: totals.earnedCents,
        usedCents: totals.appliedCents,
        bankedCents: totals.bankedCents,
      };
    }),
  };
}

export type MyDuesMonth = MonthRollup & {
  incidents: LateIncident[];
  venmoRequested: boolean;
  isPaid: boolean;
};

export type MyDues = {
  term: string;
  totals: TermTotals;
  outstandingCents: number;
  months: MyDuesMonth[];
};

/** One dancer's own charges, and only their own.
 *
 * Takes no user id on purpose. An id in the arguments is an id somebody can
 * change, and the one thing this must never do is show one dancer another
 * dancer's money. The session decides whose figures come back, full stop. */
export async function getMyDues(termLabelInput: string): Promise<MyDues> {
  const user = await requireUser();

  const term = parseTermLabel(termLabelInput);
  if (!term) throw new Error(`"${termLabelInput}" is not a term.`);
  const label = termLabel(term);

  const [incidents, credits, settlements] = await Promise.all([
    incidentsByMonth(term),
    creditsByMonth(label),
    prisma.monthlyDuesSettlement.findMany({
      where: { userId: user.id, term: label },
      select: { month: true, year: true, venmoRequested: true, isPaid: true },
    }),
  ]);

  const settlementFor = new Map(
    settlements.map((s) => [monthKey(s.month, s.year), s]),
  );

  const months: MyDuesMonth[] = waterfallFor(user.id, term, incidents, credits).map(
    (m) => {
      const key = monthKey(m.month, m.year);
      const settled = settlementFor.get(key);
      return {
        ...m,
        incidents: incidents.get(key)?.get(user.id) ?? [],
        venmoRequested: settled?.venmoRequested ?? false,
        isPaid: settled?.isPaid ?? false,
      };
    },
  );

  const totals = totalsForTerm(months);
  return {
    term: label,
    totals,
    outstandingCents: months
      .filter((m) => !m.isPaid)
      .reduce((t, m) => t + m.netCents, 0),
    months,
  };
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/** Every screen that shows a charge, in both shells.
 *
 * The ledger is mounted twice — once inside the admin console and once in the
 * dancer app — and a dancer's own copy of the same figures lives on a third
 * page. Revalidating one of the three is how a waiver ends up visible to the
 * AD and invisible to the person it was for. */
function revalidateDues(): void {
  revalidatePath("/dues");
  revalidatePath("/admin/attendance-charges");
  revalidatePath("/my-attendance");
}

/** Ticks Venmo requested or Paid for one person and one month.
 *
 * Marking a month paid records what it cost at that moment. A practice edited
 * afterwards changes what the month would cost today, and a receipt should
 * not move with it. */
export async function setSettlement(
  userId: string,
  month: number,
  year: number,
  field: "venmoRequested" | "isPaid",
  value: boolean,
): Promise<void> {
  const actor = await requireFinance();

  const term = termForMonth(month, year);
  if (!term) throw new Error("That month is outside a term.");

  let settledCents: number | null = null;
  if (field === "isPaid" && value) {
    const ledger = await getMonthlyDuesLedger(month, year);
    settledCents = ledger.rows.find((r) => r.userId === userId)?.netCents ?? 0;
  }

  const base = {
    term: termLabel(term),
    updatedById: actor.id,
    [field]: value,
    ...(field === "isPaid"
      ? { paidAt: value ? new Date() : null, settledCents }
      : {}),
  };

  await prisma.monthlyDuesSettlement.upsert({
    where: { userId_month_year: { userId, month, year } },
    update: base,
    create: { userId, month, year, ...base },
  });

  revalidateDues();
}

/** Logs one thing a dancer did that earns credit.
 *
 * A row per occurrence rather than a counter, so the AD can take back a
 * single entry typed by mistake without recounting the rest, and the dancer
 * can see when they earned it.
 *
 * The category's value is copied onto the row rather than looked up later. If
 * the AD decides next month that a workshop is worth two dollars, this term's
 * ledger has to keep saying what people were actually told. */
export async function addCredit(
  userId: string,
  categoryId: string,
  termLabelInput: string,
): Promise<void> {
  const actor = await requireFinance();
  const term = parseTermLabel(termLabelInput);
  if (!term) throw new Error(`"${termLabelInput}" is not a term.`);

  const category = await prisma.creditCategory.findUnique({
    where: { id: categoryId },
    select: { cents: true, archivedAt: true },
  });
  if (!category) throw new Error("That credit category no longer exists.");
  if (category.archivedAt) {
    throw new Error("That credit category has been removed, so nothing new can be logged against it.");
  }

  // Today, unless today is outside the term being logged against — in which
  // case the term's first month, so a credit logged in January for the autumn
  // still lands inside the autumn.
  const here = zonedParts(new Date());
  const insideTerm = termForMonth(here.month, here.year);
  const occurredOn =
    insideTerm && termLabel(insideTerm) === termLabel(term)
      ? parseAppDateTime(
          `${here.year}-${String(here.month).padStart(2, "0")}-${String(here.day).padStart(2, "0")}`,
        )
      : monthBounds(monthsInTerm(term)[0].month, monthsInTerm(term)[0].year).start;

  await prisma.attendanceCredit.create({
    data: {
      userId,
      categoryId,
      cents: category.cents,
      term: termLabel(term),
      occurredOn,
      loggedById: actor.id,
    },
  });

  revalidateDues();
}

/** Takes back the most recent credit of that category, for a mis-tap. */
export async function removeCredit(
  userId: string,
  categoryId: string,
  termLabelInput: string,
): Promise<void> {
  await requireFinance();
  const term = parseTermLabel(termLabelInput);
  if (!term) throw new Error(`"${termLabelInput}" is not a term.`);

  const latest = await prisma.attendanceCredit.findFirst({
    where: { userId, categoryId, term: termLabel(term) },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) return;

  await prisma.attendanceCredit.delete({ where: { id: latest.id } });
  revalidateDues();
}

/* ------------------------------------------------------------------ *
 * Corrections
 * ------------------------------------------------------------------ */

/** Writes a charge off, with a reason the dancer can read.
 *
 * The charge is not deleted and the minutes are not touched. Somebody was
 * late, the record still says so, and the ledger shows what it would have
 * cost beside the reason it wasn't collected. A waiver that erased the
 * incident would leave the AD unable to answer "why is this month lower than
 * I remember".
 *
 * Admin-only. The treasurer chases payments; deciding that a payment isn't
 * owed is the AD's call. */
export async function waiveCharge(
  attendanceId: string,
  reason: string,
): Promise<void> {
  const actor = await requireAdmin();
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A waiver needs a reason.");

  await prisma.chargeWaiver.upsert({
    where: { attendanceId },
    update: { reason: trimmed, waivedById: actor.id },
    create: { attendanceId, reason: trimmed, waivedById: actor.id },
  });
  revalidateDues();
}

/** Puts a waived charge back on the books. */
export async function unwaiveCharge(attendanceId: string): Promise<void> {
  await requireAdmin();
  await prisma.chargeWaiver.deleteMany({ where: { attendanceId } });
  revalidateDues();
}

/** Corrects how late somebody actually was.
 *
 * For the case the AD kept hitting: the sheet says twelve minutes because the
 * rehearsal didn't start when the calendar said it would, and the dancer is
 * being charged two dollars for something that wasn't their fault. Changing
 * the number re-prices the charge through whichever ladder was in force that
 * day, so the correction lands at the right rate rather than today's.
 *
 * Marked as an override, so the attendance sheet shows it was decided rather
 * than measured. Admin-only, deliberately: a choreographer can already set
 * the real start time for the whole practice, which is the honest fix when a
 * rehearsal ran late. Editing one person's minutes is changing what they owe,
 * and that stays with the AD. */
export async function setMinutesLate(
  attendanceId: string,
  minutesLate: number,
): Promise<void> {
  const actor = await requireAdmin();
  if (!Number.isFinite(minutesLate) || minutesLate < 0) {
    throw new Error("Minutes late has to be zero or more.");
  }

  const record = await prisma.attendance.findUniqueOrThrow({
    where: { id: attendanceId },
    select: { practiceId: true },
  });

  await prisma.attendance.update({
    where: { id: attendanceId },
    data: {
      minutesLate: Math.round(minutesLate),
      isOverride: true,
      markedById: actor.id,
      markedAt: new Date(),
    },
  });

  revalidateDues();
  revalidatePath(`/attendance/${record.practiceId}`);
  revalidatePath("/admin/attendance");
}

/* ------------------------------------------------------------------ *
 * Rates and categories
 * ------------------------------------------------------------------ */

export type RateSettings = {
  schedules: {
    id: string;
    effectiveFrom: string;
    note: string | null;
    tiers: FeeTier[];
    /** True for the one pricing charges today. */
    isCurrent: boolean;
    /** False once a charge has been priced by it, so the AD can tell which
     * rows are safe to delete outright. */
    isFuture: boolean;
  }[];
  categories: { id: string; name: string; cents: number; inUse: boolean }[];
};

export async function getRateSettings(): Promise<RateSettings> {
  await requireAdmin();

  const [rows, categories, used] = await Promise.all([
    prisma.feeSchedule.findMany({
      orderBy: { effectiveFrom: "desc" },
      select: {
        id: true,
        effectiveFrom: true,
        note: true,
        tiers: {
          orderBy: { fromMinutes: "asc" },
          select: { fromMinutes: true, cents: true },
        },
      },
    }),
    prisma.creditCategory.findMany({
      where: { archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, cents: true },
    }),
    prisma.attendanceCredit.groupBy({ by: ["categoryId"], _count: true }),
  ]);

  const now = new Date();
  const currentId = rows.find((r) => r.effectiveFrom <= now)?.id;
  const inUse = new Set(used.map((u) => u.categoryId));

  return {
    schedules: rows.map((r) => ({
      id: r.id,
      effectiveFrom: isoDate(r.effectiveFrom),
      note: r.note,
      tiers: r.tiers,
      isCurrent: r.id === currentId,
      isFuture: r.effectiveFrom > now,
    })),
    categories: categories.map((c) => ({ ...c, inUse: inUse.has(c.id) })),
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Adds or replaces a fee ladder, effective from a date.
 *
 * Changing the rates does not re-price anything already charged. A new ladder
 * starts on the day it says and everything before it keeps the price people
 * were told, which is the whole reason schedules are dated rather than being
 * one editable table. */
export async function saveFeeSchedule(input: {
  id?: string;
  effectiveFrom: string;
  note?: string;
  tiers: { fromMinutes: number; cents: number }[];
}): Promise<void> {
  const actor = await requireAdmin();

  const effectiveFrom = parseAppDateTime(input.effectiveFrom);
  if (Number.isNaN(effectiveFrom.getTime())) {
    throw new Error("That start date isn't a date.");
  }

  const clean = input.tiers
    .filter((t) => Number.isFinite(t.fromMinutes) && Number.isFinite(t.cents))
    .map((t) => ({
      fromMinutes: Math.max(0, Math.round(t.fromMinutes)),
      cents: Math.max(0, Math.round(t.cents)),
    }));
  if (clean.length === 0) {
    throw new Error("A ladder needs at least one rung, or nothing is ever charged.");
  }
  // Two rungs starting at the same minute is a unique-constraint error from
  // the database and a coin toss from the pricing function. Caught here so it
  // reads as a sentence instead.
  const minutes = new Set(clean.map((t) => t.fromMinutes));
  if (minutes.size !== clean.length) {
    throw new Error("Two rungs can't start at the same number of minutes.");
  }

  await prisma.$transaction(async (tx) => {
    if (input.id) {
      await tx.feeTier.deleteMany({ where: { scheduleId: input.id } });
      await tx.feeSchedule.update({
        where: { id: input.id },
        data: { effectiveFrom, note: input.note?.trim() || null },
      });
      await tx.feeTier.createMany({
        data: clean.map((t) => ({ ...t, scheduleId: input.id! })),
      });
      return;
    }
    const created = await tx.feeSchedule.create({
      data: {
        effectiveFrom,
        note: input.note?.trim() || null,
        createdById: actor.id,
      },
      select: { id: true },
    });
    await tx.feeTier.createMany({
      data: clean.map((t) => ({ ...t, scheduleId: created.id })),
    });
  });

  revalidateDues();
  revalidatePath("/admin/attendance-charges");
}

/** Removes a fee ladder.
 *
 * Refuses to remove the last one. With no schedules at all the app falls back
 * to the ladder it shipped with, which would quietly undo a rate change
 * rather than reporting a problem. */
export async function deleteFeeSchedule(id: string): Promise<void> {
  await requireAdmin();
  const count = await prisma.feeSchedule.count();
  if (count <= 1) {
    throw new Error("There has to be at least one set of rates.");
  }
  await prisma.feeSchedule.delete({ where: { id } });
  revalidateDues();
  revalidatePath("/admin/attendance-charges");
}

/** Adds a credit category, or changes an existing one's name and value.
 *
 * Changing the value does not change credits already logged: each one copied
 * the amount when it was earned. */
export async function saveCreditCategory(input: {
  id?: string;
  name: string;
  cents: number;
}): Promise<void> {
  await requireAdmin();
  const name = input.name.trim();
  if (!name) throw new Error("A category needs a name.");
  if (!Number.isFinite(input.cents) || input.cents < 0) {
    throw new Error("A category is worth zero or more.");
  }
  const cents = Math.round(input.cents);

  if (input.id) {
    await prisma.creditCategory.update({
      where: { id: input.id },
      data: { name, cents },
    });
  } else {
    const last = await prisma.creditCategory.findFirst({
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    await prisma.creditCategory.create({
      data: { name, cents, sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
  }
  revalidateDues();
  revalidatePath("/admin/attendance-charges");
}

/** Retires a credit category.
 *
 * Archived rather than deleted whenever anybody has earned one. The credits
 * are real money off somebody's bill and the row has to keep resolving to a
 * name; deleting the category would either orphan them or wipe them. A
 * category nobody has used is deleted outright, because a typo shouldn't live
 * on the list forever. */
export async function removeCreditCategory(id: string): Promise<void> {
  await requireAdmin();
  const used = await prisma.attendanceCredit.count({ where: { categoryId: id } });
  if (used > 0) {
    await prisma.creditCategory.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  } else {
    await prisma.creditCategory.delete({ where: { id } });
  }
  revalidateDues();
  revalidatePath("/admin/attendance-charges");
}

/** Hands one dancer the dues ledger, and nothing else.
 *
 * Admin-only, deliberately: the finance flag must not be able to grant
 * itself. */
export async function setFinanceAdmin(
  userId: string,
  value: boolean,
): Promise<void> {
  await requireAdmin();
  await prisma.user.update({
    where: { id: userId },
    data: { isFinanceAdmin: value },
  });
  revalidatePath("/admin/roster");
}
