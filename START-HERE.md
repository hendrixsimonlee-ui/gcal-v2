# Start here

This is the complete project. Replacing your repository's contents with it
gets you a working app — with one thing to do by hand first, because uploading
files can add and overwrite but never delete.

## 1. Delete these five things from the top level of the repo

They are the reason nothing you uploaded before took effect. Files dropped at
the repository root instead of inside `src/` sit somewhere the app never
loads, so the old code kept running and every fix looked like it did nothing.

| Delete | Why |
| --- | --- |
| `auth.ts` (at the root) | The real one is `src/auth.ts`. This copy is never loaded. |
| `lib/` (the whole folder at the root) | The real one is `src/lib/`. |
| `icon.png` (at the root) | Your logo — now correctly installed as `public/icon.png`. |
| `READ-ME-FIRST.md` | Notes from an earlier round, now out of date. |
| `WHATS-NEW.md` | Same. |

On GitHub: open the file, then the `...` menu at the top right of the file
view, then **Delete file**. For the `lib/` folder, delete the file inside it
(`lib/google-calendar.ts`) and the folder disappears with it.

**How to tell it worked:** the top level of your repo should have no `.ts`
files except `next.config.ts` and `prisma.config.ts`, and no `.png` at all.

## 2. Upload everything in this zip

Replace the contents of the repo with these files. Keep the folder structure
exactly as it is here — `src/auth.ts` has to land at `src/auth.ts`, not at
`auth.ts`. If you drag files in through the browser, drag the **top-level
folders** (`src`, `prisma`, `public`, `scripts`) rather than opening them and
dragging out what's inside; that is the mistake that caused all of this.

Commit and push. Vercel builds automatically. No migration to run, no command
to type — `prisma migrate deploy` is already part of the build.

## 3. Sign out and sign back in

This step is required, and it is the one that actually repairs the Google
connection.

Until now, signing back in could not fix anything: Auth.js stores Google's
tokens only on your very first sign-in, so every later one handed the app a
good token that it immediately discarded. The stored token stayed dead for
ever. That is fixed, but the fix only takes effect on a sign-in that happens
*after* the new code is live. So: sign out, sign back in, accept the Google
permission screen.

## 4. Publish the OAuth consent screen

Google Cloud Console -> APIs & Services -> OAuth consent screen. If it says
**Testing**, press **Publish app**.

Google expires refresh tokens after 7 days for apps still in Testing, which is
why the connection worked for a week and then died. Publishing stops it
happening again. If you skip this, step 3 will at least fix it each time
instead of leaving you stuck.

## 5. Point Spaces at a calendar of rooms

The Spaces screen reads **one** Google calendar and treats each event's
**title** as the room name, its **location** as the location, and its start
and end as when that room is yours.

Your current calendars don't have that shape. `[PADT] [AA] - Troupe Wide` is
the only one with events on it, and its titles are activities, not rooms —
syncing it would create rooms called "Chalking", "GBM #1" and "[Mandatory]
Open Auditions". The room names on it live in the location field ("hh platt")
or the description ("Em Sachs"). You also only have read access to it, so the
app could not write edits back.

Make a calendar you own — call it `[PADT] Spaces` — and put one event on it
per room booking, titled with the room name. Point Spaces at that.

If you would rather the app read the room name from the event's **location**
field instead of its title, say so and it becomes a setting.
