import {
  groupTitles,
  spaceMatchKey,
  stripBookingNotes,
  suggestedSpaceName,
} from "./space-matching";

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

// --- the case the AD actually raised ----------------------------------------

const emSachsSpellings = [
  "em sachs",
  "EM SACHS",
  "emsachs",
  "Em Sachs",
  "Em-Sachs",
  "  EM   SACHS  ",
  "Em Sachs Theater",
];
const keys = new Set(emSachsSpellings.map(spaceMatchKey));
assertEqual(keys.size, 1, "every spelling of Em Sachs reduces to one key");
assertEqual([...keys][0], "emsachs", "…and that key is 'emsachs'");

// --- rooms that really are different must stay different ---------------------

assert(
  spaceMatchKey("Platt A") !== spaceMatchKey("Platt B"),
  "Platt A and Platt B are not merged",
);
assert(
  spaceMatchKey("Studio 1") !== spaceMatchKey("Studio 2"),
  "numbered studios stay distinct",
);
assertEqual(
  spaceMatchKey("Studio 2"),
  "2",
  "a noise word is dropped when something identifying remains",
);
assertEqual(
  spaceMatchKey("Studio"),
  "studio",
  "…but a room genuinely called Studio still matches itself",
);

// --- booking notes ----------------------------------------------------------

assertEqual(
  stripBookingNotes("Em Sachs (tech week)"),
  "Em Sachs",
  "a parenthetical note is stripped",
);
assertEqual(
  stripBookingNotes("Platt B - held for PADT"),
  "Platt B",
  "a trailing note after a dash is stripped",
);
assertEqual(
  stripBookingNotes("Platt B [confirmed]"),
  "Platt B",
  "a bracketed note is stripped",
);
assertEqual(
  spaceMatchKey(stripBookingNotes("EM SACHS (tech week)")),
  spaceMatchKey("Em Sachs"),
  "a note doesn't split a room into two",
);
assertEqual(
  stripBookingNotes("Iron-Gate Studio"),
  "Iron-Gate Studio",
  "a hyphen inside a name is not treated as a note separator",
);

// --- display names ----------------------------------------------------------

assertEqual(
  suggestedSpaceName("EM SACHS"),
  "Em Sachs",
  "a shouted title is offered back in title case",
);
assertEqual(
  suggestedSpaceName("em sachs"),
  "Em Sachs",
  "a lowercase title is offered back in title case",
);
assertEqual(
  suggestedSpaceName("Em Sachs Theater"),
  "Em Sachs Theater",
  "a deliberately capitalised title is left alone",
);
assertEqual(
  suggestedSpaceName("McClelland Hall"),
  "McClelland Hall",
  "internal capitals are preserved",
);

// --- grouping ---------------------------------------------------------------

const grouped = groupTitles([
  "em sachs",
  "EM SACHS",
  "EM SACHS",
  "Platt B",
  "platt b",
  "Iron Gate",
]);
assertEqual(grouped.length, 3, "six titles collapse to three rooms");
assertEqual(
  grouped[0].displayTitle,
  "EM SACHS",
  "the most common spelling is the label",
);
assertEqual(grouped[0].eventCount, 3, "…and carries the total event count");
assert(
  grouped.every((g) => g.matchKey.length > 0),
  "no group has an empty key",
);

// Empty and junk titles must not become a room.
assertEqual(
  groupTitles(["", "   ", "()"]).length,
  0,
  "blank titles produce no rooms",
);

if (failures > 0) {
  console.error(`\n${failures} space matching test(s) failed`);
  process.exit(1);
}
console.log("\nAll space matching tests passed");
