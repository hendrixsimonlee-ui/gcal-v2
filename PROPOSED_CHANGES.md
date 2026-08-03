# Proposed changes — v2

Written up from the incoming AD's notes (PADT App Notes), then revised with
her answers. This is the agreed shape of the next version: what each piece
means in practice, what it changes about the app as it stands, and what's
still open.

**All of it is built.** This document is now the record of what was
decided and why, rather than a plan.

---

## At a glance

| Area | Today | Agreed for v2 |
| --- | --- | --- |
| Space hours | Typed in by hand | Import from one Google Calendar ✅ |
| Conflict source | Each person's *primary* Google Calendar | Each person's **PADT conflict calendar**, picked once |
| Conflict categories | Dancer picks Class / Work / Medical… | **Gone.** Dancer types a title, nothing else |
| Excused vs unexcused | Follows the category | **Not reviewed → AD marks it** excused or unexcused |
| Attendance | Choreographer ticks people off | **Dancer checks in on their own phone** |
| Lateness | Not tracked | **Minutes late**, reported per person |
| Choreographer | Marks attendance | **Reviews and submits** what the app collected |
| Notes | None | Per-practice and per-person, before and after |
| Google Calendar out | One link per practice | **One team calendar**, kept in sync with edits |

---

## 1. Spaces from Google Calendar — **DONE**

*Notes: "Import from Gcal" · "List is fine and it needs to be organized by
week" · "Ability to put in a recurring space calendar, that can just be
edited each week."*

- Each space links to one Google Calendar. Every event on it becomes a block
  the room is open, on that date, for those hours.
- **Sync bookings** pulls the next 20 weeks; re-syncing updates what moved
  and drops what was cancelled in Google. Hours typed by hand are never
  touched by a sync.
- The recurring semester block still works as before; a one-off change for a
  single date replaces that date's hours or closes the room.
- One-off changes are listed **grouped by week**, with a calendar view above
  showing what the scheduler will actually treat as bookable.

Confirmed: an event on a room's calendar means **the room is ours** then.
The shipped import reads it that way.

---

## 2. Conflicts — **DONE**

### 2a. Each person syncs their own PADT conflict calendar — **DONE**

The team creates a conflict calendar for every member at the start of the
year. The app currently imports from whatever is on their **primary**
calendar, which is the wrong one.

- Each person picks, once, **which of their Google calendars is their
  conflict calendar**. It's remembered.
- Import pulls from that calendar. Event title becomes the conflict title.
- Sync a week, or the whole term at once.
- Re-syncing updates what moved and removes what they deleted in Google;
  anything they typed directly in the app is left alone.

The point is that a member should never have to type a conflict twice — they
keep their PADT calendar up to date and the app follows it.

### 2b. No categories. The AD decides excused. — **DONE**

*Decision: dancers do not categorize anything. That's the headline.*

**Dancer:** logs a conflict with a **title** and a time. No dropdown, no
classification, no judgement call.

**AD:** every conflict arrives as **Not reviewed**. Conflict Review is the
weekly triage screen:

- Grouped **by person**, that person's week under their name.
- The **title is the most prominent thing** on each row, then the time.
- One control: **Excused / Unexcused**.
- Bulk-mark a person's whole week at once.
- A clear count of what's still unreviewed, so "have I gone through
  everything?" is answerable at a glance.

Three states, not two: *Not reviewed* is distinct from *Excused* so the
screen can show exactly what hasn't been looked at.

The **Conflict Categories** admin screen goes away. Existing conflicts keep
their current excused/unexcused answer so no history is lost.

---

## 3. Attendance: dancers check themselves in — **DONE**

### The dancer's side

- **Check-in opens the moment the practice starts** and closes when the
  practice is slated to end. Not before, not after.
- A notification lands on their phone **as the practice starts**, prompting
  them to check in.
- Checking in records the exact time and stores **how many minutes late**.
- **Under 5 minutes counts as on time.** 5+ is reported as late.
- **No check-in by the time it closes = unexcused absence**, automatically.
  Both the choreographer and the AD can override that.
- **Anyone with a reviewed conflict covering the practice doesn't need to
  check in** — excused or unexcused. The absence is already known and already
  classified, so the app doesn't chase them. If they turn up anyway they can
  still check in and be counted present.
- **Choreographers check in too**, for the dances they choreograph. Being in
  charge doesn't exempt you from the record.

**Honesty model: trust.** No codes, no location check. The choreographer sees
the whole list and fixes what's wrong.

### The choreographer's side

**As soon as the schedule is published**, the choreographer can see who is
going to be at each of their practices:

1. **Expected** — no conflict, should be there
2. **Excused** — AD excused them this week
3. **Coming late** — planned late arrivals (see 3a), with the time they'll get there

and after the practice starts, who has actually checked in and how late.

They can also:

- **Set the practice's real start time** if it started late. Everyone's
  lateness recalculates from that — nobody is marked late for a practice that
  hadn't begun.
- Write notes (see Section 4).

### Submitting

**When the practice is slated to end, the choreographer's phone gets a
notification** to confirm attendance. There is **no deadline on submitting** —
check-in closes on time, but a choreographer can come back and submit days
later if that's when they get to it. It opens a recap — who came, who was
late and by how many minutes, who's unexcused — which they correct and
**Submit**. Until then it's provisional. The AD can edit before or after, and
can submit on a choreographer's behalf.

### 3a. Planned late arrivals — **DONE**

Some people simply have to come late every week — a class that ends at 6:15
for a 6:00 practice. This must be quick to enter while building the schedule,
not something to remember to explain each week.

- Mark a cast member as **arriving at HH:MM** for a practice, right from the
  Schedule Builder and from the practice's own screen.
- They show in the choreographer's **Coming late** group.
- They still check in — but arriving at or before their agreed time counts as
  **on time**, not late.
- Planned late arrivals appear in the team calendar event description.

### What's tracked, and what isn't (yet)

Minutes late is recorded and reported per person, per practice, and rolled up
over the season. **No point or charge counting for now** — the intent is that
every minute late is a charge, so the data is recorded at minute resolution
and charge rules can be layered on later without re-collecting anything.

**Lateness stays separate from the chronic-absence flag.** That flag keeps
counting unexcused absences only.

---

## 4. Notes, everywhere they're needed — **DONE**

The AD's point: things go wrong and people need somewhere to say so, before
and after, and it should reach the people who need to see it.

- **On an absence** — why someone missed, what they need to catch up on,
  what went wrong. Written by the dancer, the choreographer, or the AD.
- **On a person for a specific practice, before it happens** — *"I'm going to
  be late, class runs over"* — written by that person **or** by the AD or a
  choreographer on their behalf, since it often gets said in person or over
  text first.
- **On the practice as a whole** — what got covered, what got missed, why it
  ran short.

Notes written before a practice show up in the choreographer's pre-practice
view **and** in the team calendar event, so they're visible without opening
the app.

---

## 5. The team Google Calendar — **DONE**

**The calendar lives on the `panasianartistic` account.** That account owns
it and grants the app write access — a club account, so it survives ADs
changing.

### Event format

Every published practice writes one event:

| Field | Contents |
| --- | --- |
| **Title** | Dance name + its number for the year — *"Bhangra 7"*. Just the number, no word "Practice". Counted per dance, per season. |
| **Location** | The studio |
| **Description** | Who's excused · who's unexcused · who's slated to come late (with times) · any notes written ahead of the practice |

### Editing after publishing — the priority

*"My biggest concern is ease if it needs to be edited."*

- The AD edits a practice **in the Schedule Builder** — move it, change the
  room, change who's coming late — and the Google Calendar event is
  **updated in place**. Not deleted and recreated, not duplicated.
- Everyone in that dance is notified of what changed.
- The same applies to changes in the description: excusing someone after
  publishing updates the event.
- Cancelling a practice removes the event.
- **The calendar updates itself the same way the app does** — no "push to
  calendar" button to remember. An edit in the app is an edit on the calendar.
- The description reflects the **plan**, not the outcome. It is not rewritten
  after attendance is submitted; the actual record lives in the app.

### Individuals

- **My Schedule** gets **"Add this week to my calendar"** — every dance that
  person has that week, into whichever of their own calendars they pick.
- The existing per-practice link stays for one-offs.

---

## 6. Seamlessness — **DONE**

Called out explicitly, so it's a requirement rather than a nice-to-have:

- **Autosave wherever it's safe.** Notes, conflict review marks, planned late
  arrivals, and attendance overrides save as you go, with a quiet "saved"
  indicator — no Save button to forget.
- Publishing stays an explicit, deliberate action. That one is not autosaved,
  because it's what tells 40 people their week.
- The weekly order (review conflicts → sync spaces → schedule → publish)
  should be visible as a checklist on the admin home rather than something to
  remember.

---

## 7. The week, in order

| # | Who | What |
| --- | --- | --- |
| 1 | Dancers | Keep their PADT conflict calendar current; the app syncs it |
| 2 | AD | **Conflict Review** — person by person, mark excused / unexcused |
| 3 | AD | **Spaces** — sync the room calendar, adjust this week's differences |
| 4 | AD | **Schedule Builder** — every dance scheduled or marked off; note planned late arrivals |
| 5 | AD | **Publish** — everyone notified, team calendar written |
| 6 | Choreographers | See who's coming to each practice |
| 7 | Dancers | Notified as practice starts; check in |
| 8 | Choreographers | Notified as practice ends; review recap, submit |
| 9 | AD | **Attendance Review** — absences, minutes late, overrides, notes |

---

## 8. What was built, in order

1. ✅ Conflict calendar per person (2a)
2. ✅ Conflicts without categories + three-state review (2b)
3. ✅ Check-in, lateness, and the two notifications (3)
4. ✅ Planned late arrivals, with suggestions from partial conflicts (3a)
5. ✅ Notes on practices and on people (4)
6. ✅ Team calendar: write, and keep in sync on every edit (5)
7. ✅ The weekly checklist, autosave, and the greeting (6, 9)

---

## 9. Look and feel — **DONE**

Called out as its own requirement, not a finishing touch:

- **Less on every screen.** Each page should answer one question. Anything
  secondary moves behind a tap.
- **Warm and personal.** A "Hi <name>" greeting at the top, friendly copy,
  rounded cards, soft colour.
- **Interactive and immediate.** Things respond when tapped; state changes are
  visible without a page reload.
- Nobody should have to be taught how to use it.

---

## 10. Decisions on the last four questions

1. **Partial conflicts are spotted automatically.** A conflict that clips the
   front of a practice shows up in the Schedule Builder as a suggestion —
   *"Sofia Rossi — Sister's graduation ends at 2:00 PM"* — with one button to
   turn it into an agreed arrival.
2. **Phone notifications need the app on the home screen.** Apple's rule, not
   a setting. The app detects an iPhone that hasn't installed it and says so
   in place, rather than offering a button that would do nothing. Anyone in a
   browser tab still gets in-app notifications and email.
3. **Note visibility** works as proposed: a note about the practice is for
   the whole cast; a note about a person is for that person, the dance's
   choreographers, and admins.
4. **"Add this week"** downloads one .ics file covering every dance that
   week. One tap, and it imports into Apple Calendar and Outlook too.

## 11. Things worth knowing

- **The Google consent screen now mentions editing calendar events.** Writing
  to the shared team calendar needs the write scope, and Auth.js requests one
  scope set for everyone at sign-in. Only an admin's token is ever used to
  write, and only to the team calendar — but the wording the team sees is
  broader than that.
- **Notifications are driven by a scheduled request**, not by the app waking
  itself up: `/api/cron/practice-notifications` runs every five minutes (see
  `vercel.json`) and sends whatever is due.
- **Nothing about Google has been exercised against a real account.** There
  were no OAuth credentials in the build environment, so the conflict sync,
  the space import, and the team calendar write are all unproven until
  deployment. Every failure path degrades gracefully and says so on screen;
  the happy paths need a real run.
