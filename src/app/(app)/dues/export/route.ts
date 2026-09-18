import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { auth } from "@/auth";
import {
  currentTerm,
  getCreditLedger,
  getMonthlyDuesLedger,
  getTermSummary,
} from "@/lib/actions/dues";
import {
  monthLabel,
  monthsInTerm,
  parseTermLabel,
  termLabel,
  toDollars,
} from "@/lib/attendance-fees";

/** The semester as a spreadsheet, for the people who still want one.
 *
 * Two sheets, mirroring the two halves of the summary tab: where the charges
 * came from, and who owes what.
 *
 * The dance sheet carries real `=SUM()` formulas rather than pasted numbers.
 * That is the whole point of exporting to a spreadsheet rather than a PDF —
 * somebody will insert a row, and a column of constants would then be quietly
 * wrong while looking exactly as authoritative as before. It is also the
 * failure mode of the tracker this replaces. */
export async function GET(request: NextRequest) {
  const session = await auth();
  const user = session?.user;
  if (!user?.isAdmin && !user?.isFinanceAdmin) {
    return new NextResponse("Not allowed", { status: 403 });
  }

  const asked = request.nextUrl.searchParams.get("term") ?? "";
  const term = parseTermLabel(asked) ?? (await currentTerm());
  const label = termLabel(term);
  const months = monthsInTerm(term);

  const [summary, creditLedger] = await Promise.all([
    getTermSummary(label),
    getCreditLedger(label),
  ]);
  const credits = creditLedger.rows;

  const book = XLSX.utils.book_new();

  /* ---- Sheet 1: who ran up the charges ---- */

  const header = ["Dancer", ...months.map((m) => monthLabel(m.month)), "Total"];
  const danceRows = summary.dancers.map((d) => [
    d.name,
    ...months.map((m) => toDollars(d.byMonth[`${m.year}-${m.month}`] ?? 0)),
    null, // filled with a formula below
  ]);

  const recon = summary.reconciliation;
  const reconRow = (name: string, values: Record<string, number>, sign = 1) => [
    name,
    ...months.map((m) => sign * toDollars(values[`${m.year}-${m.month}`] ?? 0)),
    null,
  ];

  const blank = new Array(header.length).fill(null);
  const sheet1 = XLSX.utils.aoa_to_sheet([
    [`${label} — late charges by dancer`],
    blank,
    header,
    ...danceRows,
    ["Total", ...months.map(() => null), null],
    blank,
    ["Reconciliation"],
    header.map((h, i) => (i === 0 ? "" : h)),
    reconRow("Charges", recon.grossByMonth),
    reconRow("Credits applied", recon.appliedByMonth, -1),
    reconRow("Owed", recon.netByMonth),
    reconRow("Collected", recon.collectedByMonth),
    reconRow("Still outstanding", recon.outstandingByMonth),
  ]);

  // Cells written after `aoa_to_sheet` fall outside the range it computed, and
  // a cell outside `!ref` is one Excel never reads. Every formula below went
  // in correctly and the Total columns still opened empty, which is a
  // spectacularly quiet way to fail. So the range is widened afterwards.
  // A formula cell also needs a cached value. Without `v` the writer treats
  // the cell as empty and drops it on the way out, formula and all — which is
  // how the Total columns came back blank while the code that wrote them
  // looked perfectly correct. Excel recalculates on open; the cached figure
  // is what anything that doesn't recalculate will show.
  const formula = (
    sheet: XLSX.WorkSheet,
    row: number,
    col: number,
    f: string,
    v: number,
  ) => {
    sheet[XLSX.utils.encode_cell({ r: row - 1, c: col })] = { t: "n", v, f };
  };

  const widen = (sheet: XLSX.WorkSheet, rows: number, cols: number) => {
    sheet["!ref"] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: rows - 1, c: cols - 1 },
    });
  };

  // Row numbers are 1-based in a spreadsheet, and the header sits on row 3, so
  // the dancer rows start at 4.
  const firstDance = 4;
  const lastDance = firstDance + danceRows.length - 1;
  const totalCol = months.length + 1; // 0-based: column A is the name
  const colLetter = (i: number) => XLSX.utils.encode_col(i);

  danceRows.forEach((_, i) => {
    const row = firstDance + i;
    formula(
      sheet1,
      row,
      totalCol,
      `SUM(${colLetter(1)}${row}:${colLetter(months.length)}${row})`,
      toDollars(summary.dancers[i].grossCents),
    );
  });

  if (danceRows.length > 0) {
    const totalsRow = lastDance + 1;
    for (let c = 1; c <= totalCol; c++) {
      const cached =
        c === totalCol
          ? summary.dancers.reduce((t, d) => t + d.grossCents, 0)
          : summary.dancers.reduce(
              (t, d) =>
                t + (d.byMonth[`${months[c - 1].year}-${months[c - 1].month}`] ?? 0),
              0,
            );
      formula(
        sheet1,
        totalsRow,
        c,
        `SUM(${colLetter(c)}${firstDance}:${colLetter(c)}${lastDance})`,
        toDollars(cached),
      );
    }
  }

  const reconFirst = lastDance + 5; // blank, heading, header, then the rows
  const reconTotals = [
    recon.totals.grossCents,
    -recon.totals.appliedCents,
    recon.totals.netCents,
    recon.totals.collectedCents,
    recon.totals.outstandingCents,
  ];
  reconTotals.forEach((cents, i) => {
    const row = reconFirst + i;
    formula(
      sheet1,
      row,
      totalCol,
      `SUM(${colLetter(1)}${row}:${colLetter(months.length)}${row})`,
      toDollars(cents),
    );
  });

  widen(sheet1, reconFirst + 5, header.length);
  sheet1["!cols"] = [{ wch: 26 }, ...months.map(() => ({ wch: 11 })), { wch: 12 }];
  XLSX.utils.book_append_sheet(book, sheet1, "Charges by dancer");

  /* ---- Sheet 2: who owes what ---- */

  const ledgers = await Promise.all(
    months.map((m) => getMonthlyDuesLedger(m.month, m.year)),
  );

  const creditFor = new Map(credits.map((c) => [c.userId, c]));
  const people = credits.map((c) => ({ userId: c.userId, name: c.name }));

  const memberHeader = [
    "Dancer",
    ...months.map((m) => `${monthLabel(m.month)} charges`),
    "Charges total",
    "Credits earned",
    "Credits used",
    "Credits banked",
    "Owed",
    "Venmo requested",
    "Paid",
  ];

  const memberRows = people.map((person) => {
    const perMonth = ledgers.map(
      (l) => l.rows.find((r) => r.userId === person.userId)?.grossCents ?? 0,
    );
    const owed = ledgers.reduce(
      (t, l) => t + (l.rows.find((r) => r.userId === person.userId)?.netCents ?? 0),
      0,
    );
    const credit = creditFor.get(person.userId);
    const anyVenmo = ledgers.some(
      (l) => l.rows.find((r) => r.userId === person.userId)?.venmoRequested,
    );
    // "Paid" across a semester only means something if every month that owed
    // anything has been settled, so it is an all-or-nothing answer rather
    // than a count that would read as progress.
    const owingMonths = ledgers.filter(
      (l) => (l.rows.find((r) => r.userId === person.userId)?.netCents ?? 0) > 0,
    );
    const allPaid =
      owingMonths.length > 0 &&
      owingMonths.every(
        (l) => l.rows.find((r) => r.userId === person.userId)?.isPaid,
      );

    return [
      person.name,
      ...perMonth.map(toDollars),
      null,
      toDollars(credit?.earnedCents ?? 0),
      toDollars(credit?.usedCents ?? 0),
      toDollars(credit?.bankedCents ?? 0),
      toDollars(owed),
      anyVenmo ? "Yes" : "",
      allPaid ? "Yes" : owingMonths.length === 0 ? "n/a" : "",
    ];
  });

  const sheet2 = XLSX.utils.aoa_to_sheet([
    [`${label} — credits and settlement`],
    new Array(memberHeader.length).fill(null),
    memberHeader,
    ...memberRows,
  ]);

  const chargesTotalCol = months.length + 1;
  memberRows.forEach((cells, i) => {
    const row = 4 + i;
    const cached = months.reduce(
      (t, _, m) => t + Number(cells[1 + m] ?? 0),
      0,
    );
    formula(
      sheet2,
      row,
      chargesTotalCol,
      `SUM(${colLetter(1)}${row}:${colLetter(months.length)}${row})`,
      cached,
    );
  });

  widen(sheet2, 3 + memberRows.length, memberHeader.length);
  sheet2["!cols"] = [
    { wch: 22 },
    ...months.map(() => ({ wch: 13 })),
    { wch: 14 },
    { wch: 14 },
    { wch: 13 },
    { wch: 14 },
    { wch: 10 },
    { wch: 16 },
    { wch: 8 },
  ];
  XLSX.utils.book_append_sheet(book, sheet2, "Credits and settlement");

  const body = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const filename = `PADT dues ${label.replace(/\s+/g, " ")}.xlsx`;

  return new NextResponse(body, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
