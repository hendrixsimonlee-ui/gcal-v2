# Putting the Dance Scheduler online

A step-by-step walkthrough for getting the app onto a real URL your team can
use. No prior deployment experience assumed.

You'll create four accounts (all free at this size), copy some values between
them, and click Deploy. Budget about an hour the first time. Nothing here
touches your local copy of the app — you can keep running it locally the
whole time.

**Before you start**, make sure the code is pushed to GitHub. Open GitHub
Desktop, check there's nothing waiting in "Changes", and that the top bar
doesn't offer to push anything.

---

## Step 1 — A database (Neon)

The app keeps everyone's conflicts, practices, and attendance in a
PostgreSQL database. Neon hosts one for free.

1. Go to [neon.tech](https://neon.tech) and sign up (you can use your Google
   account).
2. Create a project. Name it `dance-scheduler`. Take the default region
   closest to you.
3. When it finishes, Neon shows a **connection string** — a long line
   starting with `postgresql://`. Click **Copy**.
4. Paste it somewhere you can get at it in a minute (a note, a draft email
   to yourself). You'll need it twice.

> This string is a password. Don't put it in a message, a document you
> share, or the code.

---

## Step 2 — Google sign-in (Google Cloud)

This is what makes "Sign in with Google" work, and what lets dancers import
conflicts from their own Google Calendar.

1. Go to
   [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
   and sign in.
2. Create a new project (top-left dropdown → **New Project**). Name it
   `Dance Scheduler`.
3. In the left menu, open **APIs & Services → Library**, search for
   **Google Calendar API**, and click **Enable**.
4. Back in **Credentials**, click **Configure Consent Screen** if prompted:
   - User type: **External**
   - App name: `Dance Scheduler`, your email for both support fields
   - Scopes: skip for now (you can add nothing here and it still works)
   - Test users: add your own email
5. Now **Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `Dance Scheduler Web`
   - **Authorized redirect URIs** — add this exactly, for now:
     `http://localhost:3000/api/auth/callback/google`
     (you'll add the real one in Step 5, once you know your URL)
6. Click Create. Google shows a **Client ID** and a **Client secret**. Copy
   both next to your database string.

---

## Step 3 — Hosting (Vercel)

1. Go to [vercel.com](https://vercel.com) and **Sign up with GitHub**.
2. Click **Add New → Project**. Vercel lists your GitHub repositories; pick
   **gcal-v2** and click **Import**.
3. Don't deploy yet. Expand **Environment Variables** and add these, one at
   a time (Name on the left, Value on the right):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | the Neon connection string from Step 1 |
   | `GOOGLE_CLIENT_ID` | from Step 2 |
   | `GOOGLE_CLIENT_SECRET` | from Step 2 |
   | `AUTH_SECRET` | any long random string — see below |
   | `INITIAL_ADMIN_EMAIL` | **your** email address |
   | `CRON_SECRET` | another long random string (see below) |
   | `VAPID_PUBLIC_KEY` | see step 3b |
   | `VAPID_PRIVATE_KEY` | see step 3b |
   | `VAPID_SUBJECT` | `mailto:your-email@example.edu` |

   For `AUTH_SECRET` and `CRON_SECRET`, open Terminal and run
   `openssl rand -base64 32` once for each, then paste what it prints. (Any
   32+ random characters will do.)

   Leave `ALLOW_DEV_LOGIN` out entirely. The demo sign-in it enables cannot
   run on a live site regardless, but there's no reason to set it.

4. Click **Deploy**. It takes two or three minutes.
5. When it's done, Vercel shows your URL — something like
   `dance-scheduler-abc123.vercel.app`. Copy it.

### Step 3b — Keys for phone notifications

These let the app push a notification to someone's phone when practice
starts. In Terminal, in the project folder:

```
npx web-push generate-vapid-keys
```

It prints a public key and a private key. Paste them into Vercel as
`VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, and set `VAPID_SUBJECT` to
`mailto:` followed by your email.

If you skip this, everything still works — people just get notifications
inside the app and by email instead of on their lock screen.

> **Worth knowing:** on an iPhone, a web app can only send notifications
> once it's been **added to the home screen**. That's Apple's rule, not a
> setting. Tell the team to add it (Share → Add to Home Screen) in the same
> message as the link — the app prompts them too.

---

## Step 4 — Create the tables

The database exists but is empty. Run this once, from Terminal, in the
project folder on your Mac:

```
DATABASE_URL="<paste the Neon string here>" npx prisma migrate deploy
```

Keep the quotes. It prints a list of migrations and ends with something like
"All migrations have been successfully applied."

> Do **not** run `npm run seed:demo` against the real database — that script
> wipes everything and fills it with the sample dancers. It's for your local
> copy only.

---

## Step 5 — Tell Google the real URL

Go back to
[console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials),
open your OAuth client, and under **Authorized redirect URIs** add:

```
https://<your-vercel-url>/api/auth/callback/google
```

Save. Google sometimes takes a few minutes to apply this.

---

## Step 6 — First sign-in

1. Open your Vercel URL and click **Sign in with Google**.
2. Use the address you put in `INITIAL_ADMIN_EMAIL`. You'll land in the app
   as an admin — the **Admin Console** toggle appears in the sidebar.
3. The admin home shows a **Setting up** checklist. Work down it; it ticks
   itself off and disappears once you're done. In order:
   - **Roster** — add all ~40 people by name and email. Use the same email
     they'll sign in to Google with. They don't need to do anything yet;
     their account links up the first time they sign in.
   - **Spaces** — each room, its usual weekly hours, and any one-off
     closures you already know about.
   - **Dances** — each piece, its choreographers and cast, and its usual
     practice length.
   - **Settings** — link the shared PADT team calendar (owned by the club
     account and shared with you, with edit permission) so published
     practices write themselves onto it.
4. Send everyone the link, and point them at **Help** in the header — it
   covers adding the app to their home screen, linking their PADT conflict
   calendar, and checking in at practice.
5. Each week, open **This week** in the admin console and work down the
   checklist: review conflicts → sort the spaces → build the schedule →
   publish. Publishing is what notifies everyone and fills in the team
   calendar.

---

## Optional — email notifications

Without this, people still get notifications inside the app (the bell icon).
Email is extra.

1. Sign up at [resend.com](https://resend.com) and verify a domain, or use
   their test sending address to start.
2. Create an API key.
3. In Vercel: **Settings → Environment Variables**, add `RESEND_API_KEY` and
   `EMAIL_FROM` (e.g. `Dance Scheduler <scheduler@yourdomain.edu>`), then
   redeploy.

If email is misconfigured the app carries on and logs the problem — it never
blocks you from publishing a schedule.

---

## Installing it on phones

There's no App Store listing and none is needed. On an iPhone, open the site
in Safari → Share → **Add to Home Screen**. On Android, Chrome offers
**Install app**. It then opens like an app, full screen. Tell your team this
in the same message as the link.

---

## Making changes later

Every push to GitHub redeploys automatically. Edit locally, check it works
with `npm run dev`, commit and push in GitHub Desktop, and Vercel takes it
from there.

If a change touches the database structure (a new field, a new table), run
`npx prisma migrate deploy` against the Neon string again after pushing —
same command as Step 4.

---

## If something goes wrong

- **"Configuration" error on sign-in** — the redirect URI in Google doesn't
  exactly match your site's. It must be `https://`, no trailing slash, and
  end in `/api/auth/callback/google`.
- **Site loads but every page errors** — usually `DATABASE_URL` is wrong or
  Step 4 hasn't been run. Vercel's **Logs** tab shows the actual message.
- **You signed in but aren't an admin** — `INITIAL_ADMIN_EMAIL` has to match
  the Google account you used, exactly. Fix it in Vercel's environment
  variables, redeploy, and sign in again.
- **Someone can't see their dances** — they're on the roster under a
  different email than the one they signed in with. Check the Roster screen.
