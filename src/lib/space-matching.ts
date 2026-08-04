/** Matching room names loosely enough to be useful.
 *
 * The shared spaces calendar is written by people, so the same room shows up
 * as "EM SACHS", "em sachs", "Em Sachs Theater" and "emsachs" in the same
 * term. Treating those as four rooms makes the schedule unreadable, so
 * titles are normalised to a match key and anything sharing a key is the
 * same room.
 *
 * Deliberately conservative: it strips noise, it does not guess at
 * similarity. "Platt A" and "Platt B" stay distinct, because they are. What
 * it can't resolve goes to the AD's review list rather than being merged. */

/** Words that carry no identity — a room is the same room whether or not
 * somebody typed "Studio" after it. Stripped only when something else
 * remains, so a room genuinely called "Studio" still matches itself. */
const NOISE_WORDS = new Set([
  "the",
  "room",
  "rm",
  "studio",
  "theater",
  "theatre",
  "hall",
  "space",
  "gym",
  "practice",
  "rehearsal",
  "booking",
  "reserved",
  "reservation",
  "padt",
]);

/** The canonical key for a room name.
 *
 * Lowercased, accents folded, punctuation and whitespace removed, noise words
 * dropped. "EM SACHS", "em sachs", "Em-Sachs Theater" and "emsachs" all
 * become "emsachs". */
export function spaceMatchKey(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // A slash or dash usually separates a room from a note ("Platt B / setup")
    // rather than being part of the name.
    .replace(/[^a-z0-9\s]/g, " ")
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => !NOISE_WORDS.has(w));
  const kept = meaningful.length > 0 ? meaningful : words;

  return kept.join("");
}

/** Strips the parenthetical and trailing notes people append to a booking
 * title, so "Em Sachs (tech week)" is filed under Em Sachs.
 *
 * Applied before `spaceMatchKey` when reading a calendar, and kept separate
 * so the AD still sees the original title in the review list. */
export function stripBookingNotes(title: string): string {
  return title
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .split(/\s+[-–—]\s+/)[0]
    .trim();
}

/** The display name to create a new space with: the raw title, tidied up
 * rather than normalised, so the AD sees "Em Sachs" and not "emsachs". */
export function suggestedSpaceName(rawTitle: string): string {
  const base = stripBookingNotes(rawTitle).replace(/\s+/g, " ").trim();
  if (!base) return rawTitle.trim();

  // Leave names that already carry deliberate capitalisation alone; only
  // rescue the ones typed entirely in one case.
  const isAllOneCase = base === base.toUpperCase() || base === base.toLowerCase();
  if (!isAllOneCase) return base;

  return base
    .split(" ")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

export type TitleGroup = {
  matchKey: string;
  /** The most common raw spelling, which is what the AD is shown. */
  displayTitle: string;
  eventCount: number;
};

/** Groups raw calendar titles by match key, keeping the most frequently used
 * spelling as the label. */
export function groupTitles(titles: string[]): TitleGroup[] {
  const groups = new Map<string, Map<string, number>>();

  for (const title of titles) {
    const key = spaceMatchKey(stripBookingNotes(title));
    if (!key) continue;
    const spellings = groups.get(key) ?? new Map<string, number>();
    const label = stripBookingNotes(title).trim() || title.trim();
    spellings.set(label, (spellings.get(label) ?? 0) + 1);
    groups.set(key, spellings);
  }

  return Array.from(groups.entries())
    .map(([matchKey, spellings]) => {
      let displayTitle = "";
      let best = -1;
      let total = 0;
      for (const [label, count] of spellings) {
        total += count;
        if (count > best) {
          best = count;
          displayTitle = label;
        }
      }
      return { matchKey, displayTitle, eventCount: total };
    })
    .sort((a, b) => b.eventCount - a.eventCount);
}
