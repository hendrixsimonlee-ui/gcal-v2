# What changed in this round

This zip is the **complete** project — every file, exactly as it should sit in
the repository. Nothing is partial.

## Uploading it

Drag the contents into the GitHub web uploader, or into your local clone. If
macOS Finder asks about the folders, hold **⌥ Option** so the button says
**Merge** — plain "Replace" deletes the destination folder rather than merging
into it.

A migration is included, so the first deploy after this will run
`prisma migrate deploy` and add the new columns and tables by itself. No
manual database work.

---

## The two sync failures

**Calendars stopped at 2500 events.** Both the spaces calendar reader and the
conflict calendar reader asked Google for one page and ignored the
`nextPageToken` it came back with. A term's room bookings, or a busy
student's year of classes, was silently truncated — no error, just missing
data. Both now follow the token to the end.

**"77 bookings failed to import."** The spaces sync queued every unfamiliar
room title for review and imported *nothing* for it. On a first sync no room
is known by definition, so every booking queued and the schedule came back
empty. Now a title creates its room and imports in the same pass. The review
list survives as a tidy-up — rename, merge into a room you already had, or say
it isn't a room, which takes its imported windows back with it.

## Publishing is now a real step

Nothing reaches the team until you publish.

- Moving a **published** practice no longer messages anyone. It's marked
  *changed, not announced*, and **Publish changes** sends one note per person
  covering everything that moved. Shifting a rehearsal three times costs one
  message.
- **Publish this dance** as well as **Publish the week** — a week is rarely
  finished all at once, and republishing it used to re-announce dances that
  hadn't changed.
- Publishing a week **refuses** if a dance has nothing booked and isn't marked
  as sitting out, with a "publish anyway" if you meant it.
- The week tracker has a status dropdown: Not practising this week / Draft /
  Published.
- The only automatic message left is the check-in nudge at the start of
  practice.

## One panel per practice

Click any practice — on the grid, or in the list under it, or from the tracker
— and you get time, room, who's arriving late, publish state and attendance in
one place. Changing a room used to mean deleting the practice and rebuilding
it, which lost the late arrivals and re-announced it.

## Conflicts

- Dancers press **My conflicts are in** for a week. An empty week and an
  unanswered week now look different.
- Conflict Review opens with a dashboard of who's answered, and **Nudge
  everyone outstanding** — which only reaches the people who haven't.
- New **Dancer Calendars** screen: attach each dancer to the PADT calendar
  they shared with the club account, and sync the whole roster in one button.
  Syncing on someone's behalf now reads with your token, which is the only
  thing that works with a shared calendar.

## Smaller things

- Roster names and emails are editable in place. Fixing a typo no longer means
  deleting somebody and losing their attendance with them.
- Attendance archive, week by week, with a **Reviewed** tick that locks the
  week's records. Reopening is one click.
- Manual one-off room *openings* are gone — an opening is a real booking and
  belongs on the spaces calendar. Closures stay, and still beat everything.
- **Best times** only shows slots in the week you're looking at, with start
  *and* end times. Anything further out is behind a count.
- Cast & Conflicts is grouped by role, spells out what the checkbox does
  (leaves someone out of this week's scheduling; changes nothing in their
  record), and hides conflicts that fall outside any room's open hours.
- Start and end times everywhere — the grid, the tracker, My Schedule,
  attendance.
- The grid's room-availability shading is much stronger and today's column
  much lighter, so the two stop fighting.
