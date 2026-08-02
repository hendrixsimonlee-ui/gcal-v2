# Dance Scheduler

A shared web app for scheduling dance team practices around conflicts,
rehearsal space availability, and choreographer requirements.

## Status: all 5 layers complete

**Layer 1 — Foundation**

- Google sign-in, with roles: **AD (admin)**, **choreographer**, **dancer**
  (a person can be more than one at once — see the navigation model below)
- AD screens: **Roster**, **Spaces** (with weekly availability windows),
  **Dances** (with choreographer/cast assignment), **Conflict Categories**,
  **Conflict Review**
- Personal screens: **My Schedule** (grouped by dance), **My Conflicts**
  (weekly time-block entry, recurring conflicts, Google Calendar import,
  out-of-town/unavailability marking)
- Installable as a home-screen web app (PWA) on any phone browser

**Layer 2 — Scheduling engine + interactive builder**

- **Schedule Builder** (AD): a Google-Calendar-style week/month grid with
  drag-to-create, drag-to-move, and resize. Practices for every dance show
  on one grid so placing one doesn't blindly cost another its better slot.
- Ranked candidate slots per dance/space/duration. Hard requirements:
  space availability, no room double-booking, and all mandatory
  choreographers free. Soft ranking: fewest and least-severe cast conflicts.
- Side panel of cast conflicts with per-person **ignore** checkboxes
  (a what-if tool — it never edits anyone's real conflict record), plus the
  per-week **choreographer excuse** toggle.

**Layer 3 — Attendance**

- **Attendance Check-off** (choreographers, for their own dances): tick who
  showed up; defaults to everyone present so you only mark the exceptions.
- Absences are classified automatically against what that person logged for
  the time slot: *excused* (excused-category conflict or an out-of-town
  window) vs *unexcused* (unexcused conflict, or a no-show with nothing
  logged at all).
- **My Attendance** (everyone): per-dance history and attendance rate.
- **Attendance Review** (AD): average % of the cast missing, a
  who's-missing-overall table, per-practice breakdowns, and chronic-absence
  flags. Only unexcused absences ever count toward a flag.
- **Settings** (AD): configure the chronic-absence threshold and window
  (e.g. "3 unexcused out of the last 5").

**Layer 4 — Notifications**

- Confirming a practice notifies its whole cast: an in-app notification
  (bell in the header with an unread badge, plus a **Notifications** page)
  and an email.
- Every confirmed practice carries an **Add to Google Calendar** link, both
  in the app and in the email. It uses Google's public add-event URL, so it
  works even for people who never connected their calendar.
- Email is best-effort: with no `RESEND_API_KEY` set it simply no-ops, and a
  failed send is logged rather than blocking the AD's action. In-app
  notifications always work.
- Re-confirming an already-confirmed practice doesn't re-notify.

**Layer 5 — Historical weighting (optional)**

- The Schedule Builder can nudge away from weekdays a cast has historically
  skipped without an excuse.
- Deliberately conservative: it needs at least two past practices on a given
  weekday before inferring anything, ignores rates under 50%, only counts
  unexcused absences, and is weighted *below* a single real logged conflict
  so it only ever breaks ties.
- The AD can switch it off entirely in **Settings** for purely rule-based
  suggestions.

## Tests

`npm test` runs the scheduling and attendance logic suites (plain `tsx`
scripts, no test framework needed) — 38 assertions covering the parts where
a silent bug would be most costly: slot scoring and hard constraints,
multi-space search, excused/unexcused classification, chronic-absence
thresholds, and the bounds on historical weighting.

## Prerequisites

- Node.js 20+
- A PostgreSQL database
- A Google Cloud OAuth client (for Sign in with Google + Calendar import)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env` and fill in the values (a local `.env` with a working
   `DATABASE_URL` is already present for local development):

   - `DATABASE_URL` — your Postgres connection string
   - `NEXTAUTH_URL` — the app's base URL (e.g. `http://localhost:3000`)
   - `NEXTAUTH_SECRET` — any random secret string
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from a Google Cloud
     project's OAuth 2.0 credentials
     ([console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)).
     Add `<NEXTAUTH_URL>/api/auth/callback/google` as an authorized
     redirect URI, and enable the **Google Calendar API** for the project.
   - `RESEND_API_KEY` / `EMAIL_FROM` — *optional.* Without them the app runs
     fine and still shows in-app notifications; it just won't send email.

3. Run database migrations:

   ```bash
   npx prisma migrate dev
   ```

4. Start the dev server:

   ```bash
   npm run dev
   ```

5. Sign in with Google once — this creates your `User` row. Then, directly
   in the database, set `isAdmin = true` on that row to unlock the Admin
   Console (there's no admin bootstrap UI yet, since the first admin has to
   come from somewhere). After that, the AD can promote/demote other admins
   from the Roster screen.

## Navigation model

Dancer and choreographer roles are unified into one personal view (My
Schedule / My Conflicts / My Attendance), grouped by dance — a person can be
a dancer in one piece and choreograph another without switching modes.
Choreographing any dance simply adds **Attendance Check-off** for those
dances to the same nav. Admin access is a separate mode, reached via an
"Admin Console" toggle for anyone with `isAdmin` set.
