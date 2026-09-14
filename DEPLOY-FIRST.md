# Read this before deploying

## The build failure is fixed in this release

If you saw this:

```
Error: P1002
Timed out trying to acquire a postgres advisory lock
(SELECT pg_advisory_lock(72707369)). Timeout: 10000ms.
```

it should be gone. **You don't need to change anything in Vercel for it.**

### What happened

This release carries the first schema change the project has had since it was
set up. Every deploy before it ran `prisma migrate deploy` with nothing to
apply, so it exited immediately and never reached for a lock. This one gave it
something to do.

`prisma migrate deploy` takes a Postgres advisory lock so two deploys can't
apply the same migration at once. That lock belongs to one connection. Neon's
pooler hands each statement to whichever backend is free, so the lock is taken
on one connection and the next statement arrives on another — the lock is
never seen again and the command dies after exactly ten seconds. Hence the
10000ms.

The error named `DATABASE_URL` rather than `DIRECT_URL` because
`prisma.config.ts` falls back:
`process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"]`. With no
`DIRECT_URL`, migrations ran on the pooled connection and the failure named
the one actually used.

### The fix, and the trade-off

The build script now disables the advisory lock:

```
prisma generate && PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=true prisma migrate deploy && next build
```

Verified with `DIRECT_URL` unset: all migrations apply, the build compiles.

**What the lock was for:** stopping two deploys applying the same migration
simultaneously. Without it, two builds racing at the same instant could both
try, and one would error. For a club app that deploys a few times a week that
is not a real risk, and it's the escape hatch Prisma documents for exactly
this pooler situation.

### Setting `DIRECT_URL` is still worth doing

Not required any more, but it's the cleaner setup — migrations on a direct
connection, the app on the pooler, lock intact.

`DIRECT_URL` is the same string as `DATABASE_URL` with `-pooler` removed:

| | Host |
|---|---|
| `DATABASE_URL` | `ep-example-123456`**`-pooler`**`.us-east-2.aws.neon.tech` |
| `DIRECT_URL` | `ep-example-123456.us-east-2.aws.neon.tech` |

Everything else stays identical. Neon's dashboard shows both; untick "pooled
connection" to see the direct one.

---

## What's in this release

Nothing here needs a manual step in Vercel.

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
