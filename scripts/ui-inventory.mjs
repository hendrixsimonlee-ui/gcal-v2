/** Records every interactive element and server action in the UI.
 *
 * A restyle is only safe if you can prove nothing disappeared. Reading a
 * thousand lines of diff by eye does not prove that; comparing a before and
 * after inventory does. Run it, keep the output, restyle, run it again, diff.
 *
 *   node scripts/ui-inventory.mjs > before.txt
 *   ...make changes...
 *   node scripts/ui-inventory.mjs > after.txt
 *   diff before.txt after.txt
 *
 * Any line that disappears is a control the user can no longer reach.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/app", "src/components"];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith(".tsx") || path.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** Collapses JSX text to a comparable label: entities decoded, whitespace and
 * interpolations flattened, so reflowing a line doesn't read as a change. */
function normalise(text) {
  return text
    .replace(/\{[^{}]*\}/g, "~")
    .replace(/&rsquo;|&apos;/g, "'")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const findings = [];

for (const root of ROOTS) {
  for (const file of walk(root).sort()) {
    // Styling is stripped before anything is matched. This exists to prove a
    // restyle changed no behaviour, so class names must not be able to
    // register as a difference — and an arrow function inside an attribute
    // otherwise breaks tag parsing on its ">".
    const src = readFileSync(file, "utf8")
      .replace(/className=\{`[\s\S]*?`\}/g, "")
      .replace(/className="[^"]*"/g, "")
      .replace(/className=\{[^}]*\}/g, "");
    const rel = file;

    // Interactive elements, with whatever label sits inside them.
    const tagPattern =
      /<(button|Link|a|select|input|textarea|form|details|summary|FullCalendar)\b([^>]*?)(\/?)>([\s\S]*?)(?:<\/\1>|(?=<\1\b))/g;
    let match;
    while ((match = tagPattern.exec(src)) !== null) {
      const [, tag, attrs, selfClosing, inner] = match;
      const label = selfClosing ? "" : normalise(inner).slice(0, 70);

      const name = /\bname="([^"]+)"/.exec(attrs)?.[1];
      const type = /\btype="([^"]+)"/.exec(attrs)?.[1];
      const href = /\bhref=[{"]([^"}]+)/.exec(attrs)?.[1];
      const action = /\baction=\{?([A-Za-z0-9_.]+)/.exec(attrs)?.[1];
      const onClick = /\bonClick=\{?\(?\)?\s*=>\s*([A-Za-z0-9_.]+)/.exec(attrs)?.[1];

      const parts = [tag];
      if (type) parts.push(`type=${type}`);
      if (name) parts.push(`name=${name}`);
      if (href) parts.push(`href=${href}`);
      if (action) parts.push(`action=${action}`);
      if (onClick) parts.push(`onClick=${onClick}`);
      if (label) parts.push(`"${label}"`);

      findings.push(`${rel}\tELEMENT\t${parts.join(" ")}`);
    }

    // Server actions and data functions the file imports — losing one of
    // these means a capability vanished even if a button remains.
    const importPattern = /import\s*\{([^}]+)\}\s*from\s*"(@\/lib\/[^"]+)"/g;
    while ((match = importPattern.exec(src)) !== null) {
      const names = match[1]
        .split(",")
        .map((n) => n.trim().replace(/^type\s+/, ""))
        .filter(Boolean)
        .sort();
      for (const name of names) {
        findings.push(`${rel}\tUSES\t${name} from ${match[2]}`);
      }
    }
  }
}

// Sorted and de-duplicated so the diff reflects real changes, not reordering.
for (const line of [...new Set(findings)].sort()) console.log(line);
console.error(`${findings.length} entries across ${ROOTS.join(", ")}`);
