<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# PADT Calendar

**Read `PROJECT_NOTES.md` before changing anything.** It carries where the app
stands, the decisions behind it, the deploy setup, and how to verify a change —
so none of that has to be re-derived from a conversation.

Five things that bite immediately:

- **Time is Eastern, always.** Every date goes through `src/lib/timezone.ts`.
  The server runs UTC, so a bare `getHours()` or `new Date(y, m, d)` silently
  moves a 7pm rehearsal. FullCalendar reports its visible range as *local*
  midnight — take a week from the middle of that range, never from its start.
- **A `"use server"` file may only export async functions.** Constants and
  types live elsewhere (`src/lib/constants.ts`).
- **Prisma 7 needs the driver adapter**, and the client generates to
  `src/generated/prisma` (gitignored). Migrations must not go through the
  connection pooler — that's what `DIRECT_URL` is for.
- **`text-accent` is wrong; use `text-accent-ink`.** `--accent` is a fill
  colour only. See the theme notes in `PROJECT_NOTES.md`.
- **Publishing is what notifies.** Editing a published practice must stage the
  change, never send it. The four notification rules are in `PROJECT_NOTES.md`
  and exist because the team stopped reading a chattier version.

## The Help pages ship with the feature

**Every user-visible change updates Help in the same commit.** Not afterwards,
not when someone asks.

- `src/app/(app)/help/page.tsx` — dancers and choreographers, as numbered
  steps in the order somebody meets them, starting from their first sign-in.
- `src/app/admin/help/page.tsx` — the AD: what each screen is for, and how the
  scheduler actually decides.

Which page depends on who the change reaches:

- Something a dancer does → the dancer page. Also the admin page **if the AD
  has to tell people about it** — they field the questions, so "the team can
  do X" belongs on their page too.
- Something only the AD does → the admin page alone. Don't clutter the dancer
  page with admin controls.
- A change to how the scheduler ranks or picks → the admin page's scheduler
  section, including any number that changed. An AD who can't explain a
  suggestion stops trusting the tool and schedules by hand.

Write it in plain language: what to press, what happens, and what to do when
it goes wrong. No jargon, no feature lists. Forty people read these instead of
asking the AD, so a feature nobody can find isn't shipped.

Two things that have gone wrong before:

- **JSX eats the space after a closing tag** when the sentence wraps, so
  `<B>Done.</B> It works` renders as "Done.It works". Use `{" "}` after the
  tag. Check the rendered page, not the source.
- **Check both pages when a feature spans them.** Grep the pair for the new
  control's name before committing; the gap is always the admin page missing
  a dancer-facing feature they'll be asked about.
