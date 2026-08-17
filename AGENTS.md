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
