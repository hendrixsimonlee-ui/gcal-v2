# Read this before deploying

One environment variable has to be right or the build fails. Everything else
in here is a normal deploy.

---

## The thing that's currently breaking the build

```
Error: P1002
Timed out trying to acquire a postgres advisory lock
(SELECT pg_advisory_lock(72707369)). Timeout: 10000ms.
```

**Cause: `DIRECT_URL` is missing from Vercel, or is set to the pooled URL.**

`prisma migrate deploy` takes a Postgres advisory lock so two deploys can't
apply the same migration at once. That lock belongs to one connection. Neon's
pooler hands each statement to whichever backend is free, so the lock is taken
on one connection and the next statement arrives on a different one — the lock
is never seen again and the command dies after exactly ten seconds. That's the
10000ms in the error.

`prisma.config.ts` already handles this:

```ts
url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"]
```

Migrations use `DIRECT_URL` **if it is set**, and fall back to the pooled
`DATABASE_URL` if it isn't. The build is hitting that fallback.

### The fix

**Vercel → your project → Settings → Environment Variables.**

`DIRECT_URL` is the same Neon connection string as `DATABASE_URL`, with
`-pooler` removed from the hostname:

| | Host |
|---|---|
| `DATABASE_URL` | `ep-example-123456`**`-pooler`**`.us-east-2.aws.neon.tech` |
| `DIRECT_URL` | `ep-example-123456.us-east-2.aws.neon.tech` |

Everything else — user, password, database name, `?sslmode=require` — stays
identical. Neon's dashboard shows both; the unpooled one is usually labelled
"direct connection".

Make sure it's enabled for **Production**, then redeploy.

### Why this started now

This release carries the first schema change since the project was set up.
Every deploy before it ran `prisma migrate deploy` with nothing to apply, so
it exited immediately and never reached for the lock. The missing variable has
been there the whole time; this is just the first deploy that needed it.

It would have failed on the next schema change whenever that came.

### If it still fails afterwards

Then `DIRECT_URL` is right and something else is holding the lock — most
likely a leftover from a previous failed attempt. Send the new error; it'll be
a different code and needs a different fix.

---

## What's in this release

Nothing here needs a manual step beyond the variable above.

- **One database migration** — `20260914120000_conflict_nudge_schedule`, four
  columns on `AppSettings` with defaults. Additive; no data is touched.
  Verified against a seeded copy: row counts identical before and after.
- The white-and-crimson brand, Plus Jakarta Sans, bigger phone tab bar
- "Send this week to Google Calendar" on the Schedule Builder
- Out-of-town dates no longer show a day early
- Push-only notifications, a 15-minute warning, and a schedulable conflicts
  nudge

---

## Two settings worth checking while you're in there

Neither breaks the build. Both make the app quieter than intended if missing.

### `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`

**This release removed email entirely.** Push is now the only way the app
reaches anybody who isn't already looking at it. Without these three, every
push is a silent no-op — people only see notifications when they open the app
and check the bell.

Generate with `npx web-push generate-vapid-keys`.

### The five-minute scheduled job

Four things run on a clock rather than because somebody pressed a button:

- the new 15-minute warning
- the check-in notification
- filling in who didn't turn up, then prompting the choreographer
- the weekly conflicts nudge, if it's switched on

They all depend on something hitting
`/api/cron/practice-notifications` every five minutes with the
`Authorization: Bearer <CRON_SECRET>` header. Setup is in `DEPLOYMENT.md`.

Without it none of the four ever fire. Everything else still works.

**`CRON_SECRET` is now required in production.** It used to be optional, which
meant a missing variable left that endpoint open to anyone who knew the URL.
It now refuses the request instead — a misconfiguration should stop
notifications, not unlock the door.

---

## After it deploys

1. Open **Settings**. The **Weekly conflicts reminder** section should be
   there. If that page errors, the migration didn't run.
2. Open **My Conflicts** and check an out-of-town window reads the dates you
   actually typed.
3. On the **Schedule Builder**, press **Send … to Google Calendar**. It will
   tell you whether a calendar is linked and how many practices landed.
