# Two things, then push

## 1. Replace the logo — one file

`public/icon.png` is a **placeholder**. Overwrite it with your dancer logo,
keeping the exact filename `icon.png`, and every icon in the app follows: the
home-screen icon, the browser tab, the header, the sign-in card and the push
notifications.

Any square PNG works. 512×512 or larger is ideal; 1024×1024 is best.

This used to be four separate files at four different sizes. It's one now
precisely so you can change it without any image tools.

## 2. Push, and Vercel deploys itself

Nothing else to do — a push to `main` starts the production build.

Afterwards, tell everyone to **delete PADT Calendar from their home screen and
re-add it**. Phones cache the old icon hard and won't refresh it on their own.

---

# What the theme looks like now

Yellow, but a warm gold rather than a highlighter. The greys went warm to match
— a gold accent on blue-grey neutrals reads as a mistake rather than a choice.

Buttons are gold with near-black text on them. That's deliberate: a yellow pale
enough to actually look yellow can't carry white text, and a yellow dark enough
for white text stops being yellow and turns brown. Links and inline text use a
deeper gold that's readable on white.

"Careful" oranges moved further towards red so they can't be mistaken for the
accent, and the dance colours on the grid dropped their orange and brown for
the same reason.

---

# One bug fixed while checking the theme

The week tracker was reading its week from the calendar grid's first visible
day, which arrives as local midnight. On a phone set to any timezone east of
Eastern that's still the previous evening here, so the tracker sat a full week
behind the grid directly above it — and every count, status dropdown and
publish button on it was acting on the wrong week.

It now takes the week from the middle of the visible range, which no timezone
offset can push out of the week.
