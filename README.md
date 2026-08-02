# Dance Scheduler

A shared web app for scheduling dance team practices around conflicts,
rehearsal space availability, and choreographer requirements.

## Status: Layer 1 of 5

This is the first build layer — the foundation. It includes:

- Google sign-in, with roles: **AD (admin)**, **choreographer**, **dancer**
  (a person can be more than one at once — see the navigation model below)
- AD screens: **Roster**, **Spaces** (with weekly availability windows),
  **Dances** (with choreographer/cast assignment), **Conflict Categories**
- Dancer screens: **My Schedule** (grouped by dance), **My Conflicts**
  (weekly time-block entry, recurring conflicts, Google Calendar import,
  out-of-town/unavailability marking)
- Installable as a home-screen web app (PWA) on any phone browser

Not yet built (later layers, see `/root/.claude/plans` in the session that
built this, or ask to continue): the interactive drag-and-drop schedule
builder, attendance tracking, email/in-app notifications, and historical
scheduling weighting.

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
