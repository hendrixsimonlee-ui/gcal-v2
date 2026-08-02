# Dance Scheduler

A shared web app for scheduling dance team practices around conflicts,
rehearsal space availability, and choreographer requirements.

## Status: Layers 1–3 of 5 complete

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

Not yet built: **Layer 4** — email + in-app notifications with an "add to
Google Calendar" link on schedule finalization; **Layer 5** — optionally
weighting future scheduling by historical attendance, with an AD toggle.

## Tests

`npm test` runs the scheduling and attendance logic suites (plain `tsx`
scripts, no test framework needed). These cover the parts where a silent
bug would be most costly — slot scoring and excused/unexcused
classification.

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
Schedule / My Conflicts), grouped by dance. Admin access is a separate
mode, reached via an "Admin Console" toggle in the nav for anyone with
`isAdmin` set.
