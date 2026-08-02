# Project notes

Durable record of what this app is, the decisions behind it, what's still
open, and how to pick it back up. Kept in the repo so none of it depends on
remembering a conversation.

---

## What this is

A shared web app for scheduling a ~40-person dance team's practices, built
to replace a personal Python CLI script (`gcal-scheduler-main`) that only
one person could run. The core loop:

> dancers log their conflicts → the AD builds a schedule around them →
> choreographers mark who showed up → the AD sees who's chronically missing

All five planned layers are built. See README for the feature list.

---

## Who uses it

- **AD (Athletic Director / scheduler)** — the admin. Manages roster,
  spaces, dances, conflict categories; builds the schedule; reviews
  attendance; owns the settings.
- **Choreographer** — mandatory attendee of their own dance; marks
  attendance after their practices.
- **Dancer** — logs conflicts, sees their schedule and attendance record.

One person can be all three at once. This drove the navigation model below.

---

## Decisions made (and why)

**Navigation: unified for dancer/choreographer, switchable for admin.**
Dancer and choreographer are not modes — a person can dance in one piece and
choreograph another, so they get one personal set of screens (My Schedule /
My Conflicts / My Attendance) grouped per dance. Choreographing a dance just
adds Attendance Check-off to that same nav. Admin is different: it's a big
enough surface to warrant its own space, so `isAdmin` users get an explicit
"Admin Console" toggle. *(User chose this explicitly over full unification.)*

**Excused vs unexcused is inferred, not asked.** When a choreographer marks
someone absent, the system cross-references what that person had logged for
that time slot: an excused-category conflict or an out-of-town window makes
it excused; an unexcused-category conflict or nothing at all makes it
unexcused. Only unexcused absences count toward a chronic-absence flag, so
somebody who reliably logs real conflicts is never penalised.

**"Any space" is the default when scheduling.** The AD normally just needs a
room, not a particular room. Candidate search runs across every space; each
suggestion names the room it would book. *(Changed after the user reviewed
screenshots — the original forced picking a space up front.)*

**Suggestions are capped at 2 per day.** A wide-open afternoon otherwise
produced eight candidates 30 minutes apart on one date — one real option
dressed up as eight.

**"Ignore this conflict" is session-only, never persisted.** It's a what-if
tool for finding a slot ("they're out all weekend anyway, don't let that
drag down every option"), not an attendance decision. It never edits
anyone's actual conflict record.

**Recurring conflicts are materialized as rows, not projected on read.**
Each week's occurrence is a real row, so the dancer or the AD can edit or
delete a single week without touching the rest. Trade-off: it only
materializes 10 weeks ahead (see Known gaps).

**Historical weighting is deliberately timid.** It needs 2+ past practices
on a weekday before inferring anything, ignores absence rates under 50%,
counts only unexcused absences, and is weighted *below* one real logged
conflict — so it breaks ties without ever overriding what people actually
said. The AD can switch it off entirely. *(User asked for the off-switch
explicitly, to "prevent machine error".)*

**Email is best-effort.** No `RESEND_API_KEY` means it silently skips; a
failed send is logged, not thrown. A mail problem must never stop the AD
confirming a practice. In-app notifications always work.

**Only the PROPOSED → CONFIRMED transition notifies**, so re-confirming
doesn't spam the cast a second time.

**Dev login is gated on two independent conditions** (`ALLOW_DEV_LOGIN=true`
AND non-production `NODE_ENV`), because `NODE_ENV` is baked in at build time
and always `production` in a real deployment. Verified against a production
build with the flag deliberately on: route 404s, UI block absent, no roster
names leak, no session issued.

---

## Open questions (never resolved — decide when they bite)

1. **Should the AD see *all* dances in the attendance check-off queue?**
   Right now `/attendance` only lists dances you personally choreograph. An
   AD who doesn't choreograph a piece can still open its check-off page
   directly, but it won't appear in their queue.
2. **Should a draft (PROPOSED) practice block a candidate slot at the same
   room?** Currently only CONFIRMED practices block. Defensible either way.
3. **Should chronic-absence flagging be per-dance or overall?** Currently
   per-dance (you're letting down that specific choreographer). Overall is
   also meaningful.

---

## Known gaps

- **Recurring conflicts stop after 10 weeks** (`RECURRING_WEEKS_AHEAD` in
  `src/lib/actions/conflicts.ts`). Fine for a term; someone has to re-add
  them next season.
- **No season archiving.** Dances have a `season` field but nothing uses it
  to hide old data.
- **Google sign-in has never been exercised for real.** There were no OAuth
  credentials in the build environment. Everything else was verified with
  real browser runs; this one flow is genuinely unproven until deployment.
- **Not deployed.** No hosting, no production database.

---

## Architecture quick reference

- **Next.js (App Router) + TypeScript**, Prisma + PostgreSQL, Auth.js
  (Google), Tailwind, FullCalendar. Installable as a PWA.
- `src/lib/scheduling.ts` — pure slot generation/scoring. No database
  access, which is why it's directly testable.
- `src/lib/attendance.ts` — pure absence classification and rollups.
- `src/lib/attendance-data.ts` — the database-touching layer over the above.
- `src/lib/actions/*` — server actions. **A `"use server"` file may only
  export async functions** — that's why `ANY_SPACE` lives in
  `src/lib/constants.ts`.
- `src/proxy.ts` — route protection. Note: Next.js renamed `middleware` to
  `proxy`; it always runs on the Node.js runtime, so no `runtime` export.
- `npm test` — 38 assertions over the scheduling and attendance logic, the
  two places a silent bug would be most costly.

---

## Working on this repo

**This session cannot push to GitHub** (403 — the environment's GitHub
integration has read-only access; several attempts to fix it failed). The
workaround has been: work is committed locally, exported as a zip, and the
user copies it into their GitHub Desktop clone and pushes.

**Always pull first** before copying files in, or GitHub Desktop offers a
force-push that would discard commits made through github.com.

Watch for deleted files — copying a folder in won't remove a file that a
change deleted (this bit us once with `src/lib/require-admin.ts`).

---

## Lesson worth keeping

Reviewing screenshots of the running app with realistic data caught three
real problems that a passing test suite did not: suggestions clustered on
one day, a 24-hour calendar grid squeezing the useful hours into a sliver,
and candidate slots rendering as unreadable overlapping fragments. Tests
prove logic; looking at the thing proves usability. Do both.
