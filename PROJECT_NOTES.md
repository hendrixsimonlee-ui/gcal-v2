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

## Where things stand (Aug 2026)

**Live at `padtcal.vercel.app`.** Vercel is connected to `main` and builds on
every push; there is no manual deploy step. Neon Postgres behind it.

Two environment variables matter more than the rest:

- `DATABASE_URL` — the **pooled** Neon host. The running app uses it.
- `DIRECT_URL` — the same string with `-pooler` removed. Only the Prisma CLI
  reads it (see `prisma.config.ts`). `prisma migrate deploy` takes a Postgres
  advisory lock, and a transaction pooler hands each statement to a different
  backend, so the lock is taken on one connection and never seen again. The
  build dies with `P1002` after exactly 10 seconds if this is missing. That is
  the first thing to check on a red build.

`npm run build` is `prisma generate && prisma migrate deploy && next build`,
so **schema changes ship themselves** on deploy.

### The Aug 2026 QA round (all shipped)

- **Calendar pagination.** Both readers asked Google for one 2500-event page
  and ignored `nextPageToken`, silently truncating a term of room bookings or
  a year of classes. `listAllEvents` in `src/lib/google-calendar.ts` is now the
  one paging loop; both callers use it.
- **Spaces sync auto-creates rooms.** Unfamiliar titles used to queue for
  review and import *nothing* — so the first sync of a term, when no room is
  known by definition, reported every booking as failed. Titles now create
  their room and import in the same pass. `SpaceNameReview` rows are flagged
  `autoCreated` and the panel is a rename/merge/not-a-room tidy-up. Ignoring a
  title deletes the windows it imported.
- **Publishing separated from editing** — see the publishing model below.
- **Unified practice editor** (`src/components/schedule-builder/practice-editor.tsx`)
  — time, room, late arrivals, publish state and attendance in one panel,
  opened by clicking any practice. Changing a room used to mean deleting the
  practice and rebuilding it, which lost its late arrivals and re-announced it.
- **Weekly conflict submission.** `ConflictSubmission` with a **nullable**
  `submittedAt` — a row can exist to record a nudge without making someone
  look like they answered. Dancers press "My conflicts are in"; the AD sees a
  dashboard and can nudge only the outstanding.
- **Dancer Calendars** (`/admin/dancer-calendars`). The team shares personal
  PADT conflict calendars with the club account, so admin-on-behalf sync now
  reads with the **actor's** token, not the target's — the target may never
  have signed in, which is the whole point.
- **Attendance archive** by week with a Reviewed tick. Ticking locks that
  week's records (`assertWeekOpen` guards override/submit/unsubmit); reopening
  is one click.
- **Roster names and emails editable in place** — correcting a typo used to
  mean deleting somebody and losing their history.
- **Manual one-off room *openings* removed**, closures kept. An opening is a
  real booking and belongs on the spaces calendar; typing one here made the
  app promise a room nobody had reserved. Recurring weekly hours stay, as the
  fallback for a room that isn't on the calendar.

### The Aug 5 round

- **Spaces come only from Google.** `space-matching.ts`, `SpaceNameReview`,
  `Space.matchKey`, per-space calendars, recurring weekly hours and manual
  closures are all gone. `SpaceAvailability` became `Booking`: one row per
  calendar event, every column required. An event's title **is** the room name,
  verbatim — no fuzzy matching, so "EM SACHS" and "Em Sachs Theater" are two
  rooms and tidy titles are the AD's job. Editing a booking in the app patches
  the Google event (`events.patch`), and removing one deletes it. Closing a
  room = deleting the event. The Spaces screen is now sync + a weekly summary
  with hours per room.
- **Exclusions are recorded.** `WeeklyExclusion` replaces both the
  choreographer-only excuse table and the dancer "ignore" checkbox that was
  browser-only state. It carries a reason (auto-filled from that week's
  conflicts) and **`settleAttendance` marks an excluded person EXCUSED_ABSENT**,
  never unexcused — the app must not penalise someone for a week it removed
  them from.
- **Unpublishing is silent.** Back-to-draft says nothing; it just stages a
  change. Marking a week NOT_PRACTISING now clears its practices even when
  published, and stages `DanceWeekOff.pendingCancellationNotice` — the tracker
  shows "Cancelled — cast not told" with **Tell the cast** / **They know**.
  Cancelling is the only action that offers to message anyone, and it asks.
- **Builder layout.** Dances are chips, not a dropdown. Three stacked cards
  became one toolbar (chips / room / minutes / draft count / Publish / Build
  the week). The tracker collapses. Calendar is `height: calc(100vh - 15rem)`
  with `expandRows`, runs 6am–midnight and scrolls, `scrollTime` opens at the
  first booked hour, `snapDuration` 15min.

### Theme and logo

Gold, warm neutrals, both light and dark. **Yellow needs two accent tokens**:
one yellow can't both look yellow and carry white text, and pushed dark enough
for white it turns brown.

- `--accent` — the fill, a warm gold. Text on it is `--on-accent`, near-black.
- `--accent-ink` — for anything that is *itself* text on a light background.
  Use `text-accent-ink`, never `text-accent`.

`--warn` is burnt orange, deliberately away from the accent; amber next to gold
reads as "press this". The dance and space swatches carry no orange, brown,
green or gold for the same reason.

**One icon file: `public/icon.png`.** Manifest, favicon, apple-touch, header
and sign-in card all point at it, and the service worker caches it. Replacing
the logo is replacing that one file — it used to be four PNGs at four sizes,
which needed image tooling. After a logo change, phones must delete and re-add
the app from the home screen; they cache the old icon hard.

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

Three states, not two. Editing and announcing are deliberately separate.

- **Draft** (`PROPOSED`) — picking a slot creates one. It reserves the room
  and shows on the AD's grid; nobody else sees it and nobody is messaged.
- **Published** (`CONFIRMED`, `publishedAt`/`announcedAt` set) — the cast has
  been told.
- **Published, changed, not announced** (`pendingAnnouncement: true`, with a
  human-readable `pendingChangeNote`). Moving or re-rooming a published
  practice lands here. The shared Google calendar still updates immediately —
  it's a reference, and a stale one is worse than a quiet one — but no
  notification goes out until the AD presses **Publish changes**.

That third state exists because the AD nudges practices around several times
in one sitting. Sending on every drag meant three messages for one decision,
and the team learned to ignore all of them.

Entry points, all in `src/lib/actions/schedule.ts`:

- `publishDance(danceId, weekOfIso)` — one dance, one week. A week is rarely
  finished at once; republishing the whole week would re-announce dances that
  hadn't changed.
- `publishWeek(weekOfIso, force)` — every dance that week. **Refuses** (returns
  `missing: string[]`, publishes nothing) when a dance has no practice and no
  `DanceWeekOff` marker. `force: true` is the AD overriding.
- `setWeekStatus(danceId, weekOfIso, status)` — backs the tracker dropdown
  (`NOT_PRACTISING` / `DRAFT` / `PUBLISHED`). Publishing through it takes the
  same path as the button, so label and behaviour can't drift.
- `confirmAllDrafts()` — every draft, every week. The "term is laid out, send
  it" button.

**The four notification rules**, which the code is built to keep:

1. Drafts never notify.
2. An edit to a published practice stages, it doesn't send.
3. Publishing sends **one batched message per person**, covering everything
   that's theirs — `notifySchedulePublished` for new, `announcePracticeChanges`
   for edits.
4. Check-in reminders stay automatic (`/api/cron/practice-notifications`).

`nudgeMissingSubmissions` follows the same spirit: it reaches only the people
who haven't submitted conflicts for that week, never the whole roster.

---

## Known gaps

- **Recurring conflicts stop after 10 weeks** (`RECURRING_WEEKS_AHEAD` in
  `src/lib/actions/conflicts.ts`). Fine for a term; someone has to re-add
  them next season.
- **Push notifications need the app on the home screen** on iOS. Apple's
  rule. The app detects it and says so instead of offering a dead button.
- **The Google consent screen asks for calendar write access from everyone**,
  because Auth.js requests one scope set at sign-in. Only an admin token ever
  writes, and only to the team calendar.
- **Practice numbers renumber.** "Bhangra 7" is counted by date within the
  dance's season, so deleting an earlier practice shifts the rest and their
  calendar events are retitled on the next sync.
- **Google round-trips are only proven in production.** No OAuth credentials
  exist in the build environment, so conflict sync, spaces sync and the team
  calendar write can only be exercised on the deployed app. Failure paths all
  degrade with a readable message; the happy paths are verified by using it.

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
- `src/lib/timezone.ts` — the single clock. Pinned to `America/New_York`, not
  a fixed offset, so DST is handled. Everything date-shaped routes through it;
  `src/lib/dates.ts` is a thin compatibility layer over it.
- `src/lib/optimizer.ts` — the whole-week solver behind "Build the week".
  Hard constraints never bend, then most-constrained-first, then attendance in
  people, then a deficit weight so the same person isn't left out every week.
  `historically-absent` is a guess about behaviour and deliberately does *not*
  count as absence.
- `npm test` — assertions over timezone, space matching, scheduling, attendance
  and the optimizer: the places a silent bug would cost the most.

---

## Working on this repo

**Claude's sandbox cannot push to GitHub** (403 from the git proxy) and cannot
reach `padtcal.vercel.app` (403 on CONNECT). It *can* read the repo through the
GitHub MCP tools, which is how "did it land?" gets answered. Deploy status has
to come from the Vercel dashboard or from a pasted build log.

The workaround for delivering code: commit locally, export the whole tree with
`git archive HEAD`, zip it, and the user copies it into their clone.

**Send complete zips, never partial ones.** And when telling someone to drag
folders in on macOS, tell them to hold **⌥ Option** so the button reads
**Merge**. Plain "Replace" *deletes* the destination folder — that instruction
once wiped ~41 files.

**Always pull first** before copying files in, or GitHub Desktop offers a
force-push that would discard commits made through github.com.

Watch for deleted files — copying a folder in won't remove a file that a
change deleted (this bit us once with `src/lib/require-admin.ts`).

### Verifying a change

- `npm run lint`, `npx tsc --noEmit`, `npm test` (pinned `TZ=UTC`).
- `next build` needs a database. Start one:
  `su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/migtest"`,
  start it on port 55432, `createdb padt`, then run with `DATABASE_URL` and
  `DIRECT_URL` both pointed at it. `prisma migrate diff --from-schema
  prisma/schema.prisma --to-config-datasource --script` must print "empty
  migration" — that proves the hand-written SQL matches the schema.
- `node scripts/ui-inventory.mjs` before and after a UI change, then diff. It
  is class-blind on purpose, so restyling registers as no change and a *lost
  control* registers as one. Every removed line must be traceable to where it
  moved.
- Screenshots with Playwright (`executablePath: '/opt/pw-browsers/chromium'`,
  and copy the script into the repo root so it resolves `playwright`). This is
  not optional polish: the last two rounds each caught a real bug — a
  mustard-brown button, and the week tracker sitting a full week behind its
  own grid — that every test suite passed straight through.

---

## Lesson worth keeping

Reviewing screenshots of the running app with realistic data caught three
real problems that a passing test suite did not: suggestions clustered on
one day, a 24-hour calendar grid squeezing the useful hours into a sliver,
and candidate slots rendering as unreadable overlapping fragments. Tests
prove logic; looking at the thing proves usability. Do both.
