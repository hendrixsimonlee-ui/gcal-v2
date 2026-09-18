# Start here

This is the whole project. Everything below is either something you have to do
once, or something that has bitten before.

## Running it from this zip

A zip of a git repository never carries `node_modules`, the generated database
client, or your `.env` — the first two because they are enormous and rebuilt
from the files that *are* here, the last because it holds secrets that must
never travel in a file anybody can forward.

So, from the unzipped folder:

```bash
npm install          # also generates the database client
npm run build        # or: npm run dev
```

**`npm run build` no longer needs a database.** It used to stop dead with
`The datasource.url property is required in your Prisma config file`, which
sends you to edit `prisma.config.ts` — entirely the wrong place, and the
reason a zip could look broken when nothing was wrong with it. If
`DATABASE_URL` is absent the build now says so, skips the migration step, and
carries on. On Vercel the variable is set, so migrations still run there.

To actually use the app locally you need a `.env` with at least:

```
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."     # the same, without "-pooler". See DEPLOY-FIRST.md
AUTH_SECRET="any long random string"
NEXTAUTH_URL="http://localhost:3000"
ALLOW_DEV_LOGIN=true              # never set this in production
```

Then `npx prisma migrate deploy` once, and `npm run dev`.

`npm run seed:demo` fills an empty database with a believable roster to click
around. **Never run it against the production database — it deletes
everything first.**

## Uploading it to the repo

Keep the folder structure exactly as it is here. `src/auth.ts` has to land at
`src/auth.ts`, not at `auth.ts`. If you drag files in through the browser,
drag the **top-level folders** (`src`, `prisma`, `public`, `scripts`) rather
than opening them and dragging out what's inside — that is the mistake that
once left dead copies of `auth.ts` and `lib/` sitting at the repository root,
shadowing nothing and confusing everything. They have now been deleted.

Commit and push. Vercel builds automatically and runs the migrations itself.

## Sign out and sign back in, once

Required after the first deploy of this code, and it is the step that actually
repairs the Google connection.

Auth.js stores Google's tokens only on your very first sign-in, so every later
one used to hand the app a good token that it immediately discarded, and the
stored one stayed dead for ever. That is fixed, but only for a sign-in that
happens *after* the new code is live. Sign out, sign back in, accept the
Google permission screen.

## Publish the OAuth consent screen

Google Cloud Console → APIs & Services → OAuth consent screen. If it says
**Testing**, press **Publish app**.

Google expires refresh tokens after 7 days for apps still in Testing, which is
why the connection worked for a week and then died. Publishing stops it
happening again.

## Point Spaces at a calendar of rooms

The Spaces screen reads **one** Google calendar and treats each event's
**title** as the room name, its **location** as the location, and its start
and end as when that room is yours.

A calendar of activities won't work: titles like "Chalking" or "GBM #1" become
rooms called Chalking and GBM #1. Make a calendar you own, call it
`[PADT] Spaces`, and put one event on it per room booking, titled with the
room name.

## The other files here

| File | What it is |
| --- | --- |
| `README.md` | What the app does, feature by feature |
| `PROJECT_NOTES.md` | Where things stand and why they were built that way |
| `DEPLOY-FIRST.md` | The `DIRECT_URL` fix and the environment variables Vercel needs |
| `DEPLOYMENT.md` | The longer deployment walkthrough |
| `AGENTS.md` | Conventions, for anyone working on the code |
