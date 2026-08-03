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

All five original layers are built, plus the v2 changes the incoming AD
asked for — see PROPOSED_CHANGES.md for those and the reasoning behind
them.

---

## Who uses it

- **AD (Athletic Director / scheduler)** — the admin. Manages roster, spaces
  and dances; decides which conflicts are excused; builds and publishes the
  schedule; reviews attendance; owns the settings.
- **Choreographer** — mandatory attendee of their own dance; reviews and
  submits its attendance after each practice.
- **Dancer** — keeps their conflict calendar current, checks themselves in
  at practice, sees their own record.

One person can be all three at once. This drove the navigation model below.

---

## Decisions made (and why)

**Navigation: unified for dancer/choreographer, switchable for admin.**
Dancer and choreographer are not modes — a person can dance in one piece and
choreograph another, so they get one personal set of screens (My Schedule /
My Conflicts / My Attendance) grouped per dance. Choreographing a dance just
adds Attendance to that same nav. Admin is different: it's a big
enough surface to warrant its own space, so `isAdmin` users get an explicit
"Admin Console" toggle. *(User chose this explicitly over full unification.)*

**Dancers never classify their own conflicts.** They type a title; every
conflict arrives NOT_REVIEWED and the AD marks it excused or unexcused in
Conflict Review. NOT_REVIEWED is a real third state so the screen can show
what hasn't been looked at — without it, "unreviewed" and "excused" are
indistinguishable and the AD can never tell whether they're done.

**Attendance is self-reported, and absence is derived.** A dancer taps Check
in; the app records the time and the minutes late. Anyone with a logged
conflict over the practice — excused or unexcused — is never asked to check
in and never marked absent for failing to. No check-in with nothing logged is
unexcused. Only unexcused absences count toward the chronic-absence flag.

**History is never hidden from the person it's about.** My Attendance shows
every practice someone has had, including pieces the AD has archived (under
"Past seasons"), and every row opens that practice's full record. Anyone in
the cast can read it, not just choreographers — an attendance disagreement
should end with both sides looking at the same page, which can't happen if
only one of them can see it.

**Lateness is tracked but deliberately kept out of the absence flag.**
Turning up late is a different problem from not turning up. Minutes are
recorded exactly so charge rules can be layered on later without
re-collecting anything.

**A note is scoped by who it's about.** A note on the practice is for the
whole cast; a note about a person is for them, their choreographers, and
admins. That's what lets "I'll be late, class runs over" be written by the
dancer *or* by whoever they told in person.

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

**A one-off space change replaces that date's usual hours, it doesn't add
to them.** "Open 3–8pm on Sunday the 9th" means 3–8pm and nothing else that
day. Both the Spaces calendar and the scheduling engine follow this rule —
they used to disagree, with the engine ignoring the changed hours and
suggesting slots in the original window.

**Archiving is reversible and never deletes.** `Dance.archivedAt` hides a
finished piece from the Schedule Builder, the week tracker, and everyone's
personal screens, and its practices stop holding rooms. Every practice and
attendance row stays; unarchiving brings it all back.

**A week off is recorded, not inferred.** `DanceWeekOff` exists because
"no practice booked" and "no practice wanted" are indistinguishable
otherwise, and the AD can never tick the week as finished. The tracker
counts a week-off dance as done.

**Every calendar is Monday-first** (`firstDay={1}`). The app's week model is
Monday-based (conflict submissions, choreographer weekly excuses, the week
tracker), so FullCalendar's default Sunday start had the visible week and the
acted-on week a day out of step.

**Dev login is gated on two independent conditions** (`ALLOW_DEV_LOGIN=true`
AND non-production `NODE_ENV`), because `NODE_ENV` is baked in at build time
and always `production` in a real deployment. Verified against a production
build with the flag deliberately on: route 404s, UI block absent, no roster
names leak, no session issued.

---

## Resolved questions

1. **AD visibility vs. AD workload.** The AD sees every dance's attendance
   (the "Every practice" view in Attendance Review, including practices
   nobody has marked yet, with a link to step in). Their own check-off
   queue stays scoped to dances they personally lead, so it doesn't become
   a to-do list for other people's rehearsals.
2. **Drafts hold their room.** A PROPOSED practice blocks candidate slots
   and drag-create at that space, and counts as a clash for its cast. This
   follows from the batch-publish workflow: the AD lays out a whole term as
   drafts before telling anyone, so without blocking they'd silently
   double-book while building.
3. **Chronic absence is measured both ways, side by side.** Per-dance
   catches the dancer letting down one choreographer; overall catches the
   dancer missing one practice of every piece — real slippage no single
   dance can see.

## Publishing model

Scheduling is two phases on purpose:

- **Draft** — picking a slot creates a PROPOSED practice. It reserves the
  room, appears on the AD's grid, and is invisible to everyone else.
- **Publish** — "Publish schedule" flips every draft to CONFIRMED at once
  and sends **one** summary notification and email per person listing all
  of their practices. Not one message per practice, which for a term's
  worth of scheduling would mean a dozen emails landing together.

`confirmPractice` (single) still exists for one-off changes after publish.

---

## Known gaps

- **Recurring conflicts stop after 10 weeks** (`RECURRING_WEEKS_AHEAD` in
  `src/lib/actions/conflicts.ts`). Fine for a term; someone has to re-add
  them next season.
- **Nothing that talks to Google has run against a real account.** There were
  no OAuth credentials in the build environment, so the conflict sync, the
  space import, and the team calendar write are unproven until deployment.
  Every failure path was checked in a browser and degrades with a clear
  message; the happy paths were not.
- **Push notifications need the app on the home screen** on iOS. Apple's
  rule. The app detects it and says so instead of offering a dead button.
- **The Google consent screen asks for calendar write access from everyone**,
  because Auth.js requests one scope set at sign-in. Only an admin token ever
  writes, and only to the team calendar.
- **Practice numbers renumber.** "Bhangra 7" is counted by date within the
  dance's season, so deleting an earlier practice shifts the rest and their
  calendar events are retitled on the next sync.
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
