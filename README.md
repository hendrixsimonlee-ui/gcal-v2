# Dance Scheduler

A shared web app for scheduling dance team practices around conflicts,
rehearsal space availability, and choreographer requirements.

## What it does

**Everyone**

- A **How this works** page in the header, written for someone who's just
  been handed the link — different sections appear depending on whether you
  also choreograph or run the schedule.
- Sign in with Google. **My Schedule** greets you by name and shows every
  dance you're in, grouped per piece.
- While a practice is running, a **Check in** button sits at the top of that
  screen. Tapping it records the time and works out how late you were —
  under five minutes counts as on time. Nobody is chased about a practice
  they already logged a conflict for.
- **My Attendance** is a full history: every practice you've had, what was
  recorded, and how late you were. Tap any one to open that practice's whole
  record — so if there's ever a question about who was there, everyone
  involved can look at the same page. Finished pieces move to "Past seasons"
  rather than disappearing.
- **My Conflicts** points at the PADT conflict calendar you were given at the
  start of the year. Sync the whole term in one tap and you never type a
  conflict twice. You can also add one by dragging on the calendar — just a
  title and a time, no categories to pick.
- **Add this week to my calendar** downloads every practice that week as one
  file, which imports into Google, Apple Calendar or Outlook in a single go.
- Installable from any phone browser. Add it to your home screen and you get
  notifications when practice starts.

**Choreographers** (for their own dances)

- See who's coming before it happens: **Expected**, **Excused**, and
  **Coming late** with the time each person agreed to arrive.
- Watch check-ins land during the practice, with minutes late per person.
- Record that the practice actually started late — everyone's lateness is
  recalculated from the real start, so nobody is penalised for a practice
  that hadn't begun.
- Write notes on the practice, or on one person in it.
- When the practice ends, a notification asks you to review the recap and
  **Submit**. There's no deadline; come back days later if you need to.

**The AD**

- **This week** — a checklist of the week's work in the order it happens:
  review conflicts → sort the spaces → build the schedule → publish → check
  attendance. Each step shows how far along it is.
- **Conflict Review** — everything logged this week, grouped by person, with
  the conflict's own title front and centre. One tap marks it excused or
  unexcused; there's a button to do a whole person's week at once, and a
  running count of what's still unreviewed.
- **Spaces** — the usual weekly hours per room, one-off changes grouped by
  week, and a calendar view of what the scheduler will actually treat as
  bookable. Link a room's Google Calendar and its bookings import
  themselves.
- **Schedule Builder** — a Google-Calendar-style grid with drag-to-create and
  drag-to-move, ranked slot suggestions across every room at once, a
  cast-conflict side panel, and a week tracker listing every dance as
  scheduled / needs a room / needs scheduling / not practising. A conflict
  that clips the front of a practice is offered as a **late arrival** in one
  tap rather than an absence.
- **Publish** flips the whole draft schedule at once, notifies everyone with
  a single summary each, and writes every practice onto the shared team
  Google Calendar — titled *"Bhangra 7"*, located at the studio, described
  with who's excused, who isn't and who's coming late. Move or cancel a
  practice later and that event updates itself.
- **Attendance Review** — by person, **lateness by month**, unexcused only,
  per dance week by week, or every practice. The lateness view breaks minutes
  out per dance and sums them for each month and each semester. Chronic
  absence is flagged both within a dance and across everything someone is in;
  lateness is reported on its own and never trips a flag.
- **A page per person** — click any name on the Roster or in Attendance
  Review: every practice they've had, their conflicts, their out-of-town
  windows, minutes late month by month, and notes about them, with the
  override on each row. This is the screen for settling "I was definitely
  there".
- **Dances** — archive a finished piece and it leaves every screen while all
  its history stays in the database.
- **Settings** — chronic-absence threshold, when someone counts as late, the
  team calendar, and an off-switch for using past attendance in scheduling.

## Tests

`npm test` runs the scheduling and attendance logic suites (plain `tsx`
scripts, no test framework needed) — 63 assertions covering the parts where
a silent bug would be most costly: slot scoring and hard constraints,
one-off space changes, multi-space search, lateness maths against agreed
arrivals and recorded late starts, who has to check in at all,
chronic-absence thresholds, and the bounds on historical weighting.

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
| **Aisha Okonkwo** | A choreographer — one Hip Hop Fusion practice waiting to be submitted |
| **Diego Alvarez** | A dancer with conflicts already logged |

The seed leaves one Contemporary practice as an unconfirmed draft, so you
can open the Schedule Builder, confirm it, and watch the notification reach
the cast. It also leaves three conflicts unreviewed and each dance's most
recent practice unsubmitted, so Conflict Review and the choreographer's
queue both open with something in them.

To make edits: change a file, save it, and the browser updates on its own.
Stop the app with `Ctrl+C`.

> **On the dev login:** it needs `ALLOW_DEV_LOGIN=true` *and* a development
> build. `NODE_ENV` is fixed to `production` in any real deployment, so this
> cannot be switched on for a live site even by mistake — verified by test.

## Deploying for real

**[DEPLOYMENT.md](DEPLOYMENT.md) is the step-by-step walkthrough** — accounts
to create, values to copy, in order. What follows is the summary.

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
- **`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`** —
  *optional.* Phone notifications when a practice starts and when it ends.
  Generate with `npx web-push generate-vapid-keys`. On iPhone these only
  arrive once the app is on the home screen.
- **`CRON_SECRET`** — guards the scheduled endpoint that sends those
  notifications (`vercel.json` runs it every five minutes).

Remember to set `NEXTAUTH_URL` to the real site URL and leave
`ALLOW_DEV_LOGIN` unset.

## Navigation model

Dancer and choreographer roles are unified into one personal view (My
Schedule / My Conflicts / My Attendance), grouped by dance — a person can be
a dancer in one piece and choreograph another without switching modes.
Choreographing any dance simply adds **Attendance Check-off** for those
dances to the same nav. Admin access is a separate mode, reached via an
"Admin Console" toggle for anyone with `isAdmin` set.
