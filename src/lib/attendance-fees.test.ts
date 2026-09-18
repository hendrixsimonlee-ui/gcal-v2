/** Tests for the dues arithmetic.
 *
 * This decides what forty people owe, so the boundaries get checked on both
 * sides rather than in the middle: 4 and 5 minutes, 9 and 10, 14 and 15, 29
 * and 30. A fee ladder is nothing but boundaries. */
import {
  calculateLateFee,
  creditsValue,
  DEFAULT_CREDIT_CATEGORIES,
  DEFAULT_FEE_TIERS,
  formatMoney,
  graceMinutes,
  monthsInTerm,
  parseTermLabel,
  runDeductionWaterfall,
  termForMonth,
  termLabel,
  toDollars,
  totalsForTerm,
} from "./attendance-fees";

let failures = 0;

function assert(cond: boolean, msg: string) {
  if (cond) console.log(`PASS: ${msg}`);
  else {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  assert(
    actual === expected,
    `${msg}${actual === expected ? "" : ` (got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)})`}`,
  );
}

// --- the fee ladder, on both sides of every step ----------------------------
{
  assertEqual(calculateLateFee(0), 0, "on time costs nothing");
  assertEqual(calculateLateFee(4), 0, "four minutes is still on time");
  assertEqual(calculateLateFee(5), 100, "five minutes is the first dollar");
  assertEqual(calculateLateFee(9), 100, "nine minutes is still a dollar");
  assertEqual(calculateLateFee(10), 200, "ten minutes is two dollars");
  assertEqual(calculateLateFee(14), 200, "fourteen is still two");
  assertEqual(calculateLateFee(15), 500, "fifteen minutes is five dollars");
  assertEqual(calculateLateFee(29), 500, "twenty-nine is still five");
  assertEqual(calculateLateFee(30), 1000, "half an hour is ten dollars");
  assertEqual(calculateLateFee(240), 1000, "and it stops there, however late");
  assertEqual(
    DEFAULT_FEE_TIERS.length,
    4,
    "the shipped ladder still has four rungs",
  );

  assertEqual(
    calculateLateFee(graceMinutes() - 1),
    0,
    "the grace threshold and the lowest rung are the same number",
  );
}
{
  // The ladder comes out of a table the AD edits, so it can arrive in any
  // order. Sorted output is not something to trust a caller for: a reversed
  // ladder would quietly charge somebody half an hour late a single dollar,
  // and nothing on screen would look wrong.
  const backwards = [
    { fromMinutes: 30, cents: 1000 },
    { fromMinutes: 5, cents: 100 },
    { fromMinutes: 15, cents: 500 },
    { fromMinutes: 10, cents: 200 },
  ];
  assertEqual(calculateLateFee(35, backwards), 1000, "a ladder in any order still charges the right rung");
  assertEqual(calculateLateFee(12, backwards), 200, "…at every rung");
  assertEqual(calculateLateFee(3, backwards), 0, "…including below the bottom one");
}
{
  // A ladder the AD has changed. Nothing about the shape is special-cased.
  const dearer = [
    { fromMinutes: 3, cents: 200 },
    { fromMinutes: 20, cents: 1500 },
  ];
  assertEqual(calculateLateFee(2, dearer), 0, "a custom grace threshold is respected");
  assertEqual(calculateLateFee(3, dearer), 200, "…and the rungs above it");
  assertEqual(calculateLateFee(25, dearer), 1500, "…right to the top");
  assertEqual(graceMinutes(dearer), 3, "the grace threshold follows the lowest rung");
}
{
  // An empty ladder must mean "nothing is chargeable", not a crash. The AD
  // could delete every rung by mistake, and the ledger should show zeroes
  // rather than a broken page.
  assertEqual(calculateLateFee(45, []), 0, "a ladder with no rungs charges nothing");
}
{
  // The app records nothing for somebody who was never marked late, and that
  // is not the same as a zero it measured. Both cost nothing, and neither
  // may throw.
  assertEqual(calculateLateFee(null), 0, "an unrecorded lateness costs nothing");
  assertEqual(calculateLateFee(undefined), 0, "…and so does a missing one");
  assertEqual(calculateLateFee(-5), 0, "arriving early is not a discount");
  assertEqual(calculateLateFee(NaN), 0, "a nonsense value costs nothing");
}

// --- credits ----------------------------------------------------------------
{
  const value = (id: string) =>
    DEFAULT_CREDIT_CATEGORIES.find((c) => c.id === id)?.cents;
  assertEqual(value("PAN_ASIAN_TIME"), 100, "leading Pan-Asian time is a dollar");
  assertEqual(value("LEAD_WORKSHOP"), 100, "leading a workshop is a dollar");
  assertEqual(value("ATTEND_WORKSHOP"), 50, "attending one is fifty cents");

  assertEqual(
    creditsValue({ PAN_ASIAN_TIME: 1, ATTEND_WORKSHOP: 3 }, DEFAULT_CREDIT_CATEGORIES),
    250,
    "counts add up: a dollar plus three halves",
  );
  assertEqual(creditsValue({}, DEFAULT_CREDIT_CATEGORIES), 0, "nothing earned is nothing owed back");

  // A category the AD invented.
  assertEqual(
    creditsValue({ AUDITIONS: 2 }, [{ id: "AUDITIONS", name: "Helped at auditions", cents: 75 }]),
    150,
    "a category the AD added counts like any other",
  );
  // And one that no longer exists: a count for it can't quietly become money.
  assertEqual(
    creditsValue({ GONE: 5 }, DEFAULT_CREDIT_CATEGORIES),
    0,
    "a count against an unknown category is worth nothing",
  );
}

// --- the waterfall ----------------------------------------------------------
{
  // Straightforward: earn two dollars in August, run up three in September.
  const out = runDeductionWaterfall([
    { month: 8, year: 2026, grossCents: 0, earnedCents: 200 },
    { month: 9, year: 2026, grossCents: 300, earnedCents: 0 },
  ]);
  assertEqual(out[0].appliedCents, 0, "credits with nothing to pay for are banked");
  assertEqual(out[0].bankedAfterCents, 200, "…and carried forward");
  assertEqual(out[1].appliedCents, 200, "then spent against the next month's charges");
  assertEqual(out[1].netCents, 100, "leaving the difference owed");
  assertEqual(out[1].bankedAfterCents, 0, "and nothing left over");
}
{
  // Credits never turn into a refund, however many are earned.
  const out = runDeductionWaterfall([
    { month: 9, year: 2026, grossCents: 100, earnedCents: 500 },
  ]);
  assertEqual(out[0].appliedCents, 100, "only as many credits are spent as there are charges");
  assertEqual(out[0].netCents, 0, "the balance never goes negative");
  assertEqual(out[0].bankedAfterCents, 400, "the rest stays banked");
}
{
  // The order is the whole point. October's credits cannot pay off August's
  // fine, because August was settled two months earlier.
  const out = runDeductionWaterfall([
    { month: 8, year: 2026, grossCents: 500, earnedCents: 0 },
    { month: 10, year: 2026, grossCents: 0, earnedCents: 500 },
  ]);
  assertEqual(out[0].netCents, 500, "an early fine is not retroactively wiped");
  assertEqual(out[1].bankedAfterCents, 500, "the later credits just bank");
}
{
  // A caller building months from a map gets whatever order the keys were in.
  // Sorting here rather than trusting the caller is the difference between
  // that being harmless and one dancer's credits silently not applying.
  const jumbled = runDeductionWaterfall([
    { month: 10, year: 2026, grossCents: 0, earnedCents: 500 },
    { month: 8, year: 2026, grossCents: 500, earnedCents: 0 },
  ]);
  assertEqual(jumbled[0].month, 8, "months are put in order first");
  assertEqual(jumbled[0].netCents, 500, "…so the answer doesn't depend on the caller");
}
{
  // Half-dollar credits, three of them, against a two-dollar fine. Exactly
  // the kind of sum that goes to 1.4999999 in floats.
  const out = runDeductionWaterfall([
    { month: 9, year: 2026, grossCents: 200, earnedCents: 150 },
  ]);
  assertEqual(out[0].netCents, 50, "three half-dollar credits leave exactly fifty cents");
  assertEqual(formatMoney(out[0].netCents), "$0.50", "…and it formats exactly");
}

// --- term totals ------------------------------------------------------------
{
  const rollups = runDeductionWaterfall([
    { month: 8, year: 2026, grossCents: 0, earnedCents: 200 },
    { month: 9, year: 2026, grossCents: 800, earnedCents: 100 },
    { month: 10, year: 2026, grossCents: 0, earnedCents: 100 },
  ]);
  const totals = totalsForTerm(rollups);
  assertEqual(totals.grossCents, 800, "gross is every charge in the term");
  assertEqual(totals.earnedCents, 400, "earned is every credit in the term");
  assertEqual(totals.appliedCents, 300, "applied is only what there were charges for");
  assertEqual(totals.netCents, 500, "net is what is actually collectible");
  assertEqual(totals.bankedCents, 100, "banked is what is left at the end of the term");
  assertEqual(
    totals.grossCents - totals.appliedCents,
    totals.netCents,
    "and the three reconcile",
  );
}

// --- semesters --------------------------------------------------------------
{
  assertEqual(termLabel(termForMonth(8, 2026)!), "Fall 2026", "August is the autumn");
  assertEqual(termLabel(termForMonth(12, 2026)!), "Fall 2026", "so is December");
  assertEqual(termLabel(termForMonth(1, 2027)!), "Spring 2027", "January is the spring");
  assertEqual(termLabel(termForMonth(5, 2027)!), "Spring 2027", "so is May");

  // June and July belong to neither, which is the AD's own boundary. Worth
  // asserting rather than leaving implicit: a fee there belongs to no
  // semester and has to be reported rather than silently dropped.
  assertEqual(termForMonth(6, 2026), null, "June is in no semester");
  assertEqual(termForMonth(7, 2026), null, "nor is July");
}
{
  assertEqual(
    monthsInTerm({ season: "FALL", year: 2026 }).map((m) => m.month).join(","),
    "8,9,10,11,12",
    "the autumn runs August to December",
  );
  assertEqual(
    monthsInTerm({ season: "SPRING", year: 2027 }).map((m) => m.month).join(","),
    "1,2,3,4,5",
    "the spring runs January to May",
  );
}
{
  // A label on a settlement row and a label in a URL have to mean the same
  // thing, so the two directions are checked against each other.
  for (const term of [
    { season: "FALL" as const, year: 2026 },
    { season: "SPRING" as const, year: 2027 },
  ]) {
    const round = parseTermLabel(termLabel(term));
    assertEqual(
      round && termLabel(round),
      termLabel(term),
      `${termLabel(term)} survives a round trip`,
    );
  }
  assertEqual(parseTermLabel("Summer 2026"), null, "an unknown season is refused");
  assertEqual(parseTermLabel("Fall"), null, "…and so is a label with no year");
}

// --- display ----------------------------------------------------------------
{
  assertEqual(formatMoney(0), "$0.00", "zero shows both decimal places");
  assertEqual(formatMoney(600), "$6.00", "whole dollars keep their cents");
  assertEqual(formatMoney(50), "$0.50", "half a dollar");
  assertEqual(formatMoney(-150), "-$1.50", "a credit reads as negative");
  assertEqual(formatMoney(123456), "$1234.56", "and it scales");

  assertEqual(toDollars(650), 6.5, "the export gets a real number, not a string");
  assertEqual(toDollars(0), 0, "…including zero");
}

if (failures > 0) {
  console.error(`\n${failures} attendance fee test(s) failed`);
  process.exit(1);
}
console.log("\nAll attendance fee tests passed");
