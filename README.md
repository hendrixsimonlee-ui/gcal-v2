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

## Try it locally (start here)

The fastest way to click through the app. You do **not** need to set up
Google sign-in for this — there's a development-only login that lets you
sign in as anyone on the roster.

**1. Install Node.js.** Download the LTS version from
[nodejs.org](https://nodejs.org) and run the installer.

**2. Get a free database.** Sign up at [neon.com](https://neon.com), create
a project, and copy the connection string it gives you (starts with
`postgresql://`). It takes about two minutes and no card. You'll reuse this
same database when you deploy, so it isn't throwaway work.

**3. Create a file named `.env`** in the project folder, containing:

```
DATABASE_URL="paste-your-neon-connection-string-here"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="any-random-string-will-do-for-local"
ALLOW_DEV_LOGIN="true"
```

**4. In Terminal, from the project folder, run these one at a time:**

```bash
npm install              # installs dependencies (a few minutes, once)
npx prisma migrate deploy # creates the database tables
npm run seed:demo        # fills it with a realistic example season
npm run dev              # starts the app
```

**5. Open [http://localhost:3000](http://localhost:3000).** The sign-in page
will show a "Local development only" section — click any name to sign in as
them. Good ones to try:

| Sign in as | To see |
| --- | --- |
| **Priya Raman** | The AD — Schedule Builder, Attendance Review, Settings |
| **Aisha Okonkwo** | A choreographer — attendance check-off for Hip Hop Fusion |
| **Diego Alvarez** | A dancer with conflicts already logged |

The seed leaves one Contemporary practice as an unconfirmed draft, so you
can open the Schedule Builder, confirm it, and watch the notification reach
the cast.

To make edits: change a file, save it, and the browser updates on its own.
Stop the app with `Ctrl+C`.

> **On the dev login:** it needs `ALLOW_DEV_LOGIN=true` *and* a development
> build. `NODE_ENV` is fixed to `production` in any real deployment, so this
> cannot be switched on for a live site even by mistake — verified by test.

## Deploying for real

Beyond the local setup above you'll need:

- **A Google Cloud OAuth client** for real Sign in with Google. Create
  credentials at
  [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials),
  add `<your-url>/api/auth/callback/google` as an authorized redirect URI,
  and enable the **Google Calendar API** for the project. Set
  `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- **Hosting.** [Vercel](https://vercel.com) connects to the GitHub repo and
  deploys on push; its free tier is ample for ~40 people.
- **`INITIAL_ADMIN_EMAIL`** — set this to your own email. Whoever signs in
  with it is made an admin automatically, which is how the first AD gets
  created. After that the AD can promote others from the Roster screen.
- **`RESEND_API_KEY` / `EMAIL_FROM`** — *optional.* Without them everything
  works and in-app notifications still appear; only email is skipped.

Remember to set `NEXTAUTH_URL` to the real site URL and leave
`ALLOW_DEV_LOGIN` unset.

## Navigation model

Dancer and choreographer roles are unified into one personal view (My
Schedule / My Conflicts / My Attendance), grouped by dance — a person can be
a dancer in one piece and choreograph another without switching modes.
Choreographing any dance simply adds **Attendance Check-off** for those
dances to the same nav. Admin access is a separate mode, reached via an
"Admin Console" toggle for anyone with `isAdmin` set.
