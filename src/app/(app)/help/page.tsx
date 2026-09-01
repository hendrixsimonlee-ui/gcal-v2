import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/** The page you point 40 people at instead of answering the same question
 * forty times.
 *
 * Written as numbered steps in the order somebody actually meets them, from
 * their first sign-in onwards, because the questions that keep coming back
 * ("where do I put my classes?", "why didn't I get told?") are all really
 * "what am I supposed to do next?". The choreographer section appears only
 * for the people it applies to, and the last section explains what happens on
 * the AD's side — people follow instructions far better when they can see why
 * the instruction exists. */
export default async function HelpPage() {
  const session = await auth();
  const user = session!.user;

  const choreographs = await prisma.danceMembership.findFirst({
    where: { userId: user.id, role: "CHOREOGRAPHER" },
    select: { id: true },
  });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          How this works
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          The whole thing in one line: tell us when you&rsquo;re busy, we build
          the schedule around it, you tap Check in at practice.
        </p>
      </div>

      <Callout>
        If you only do one thing today, do <B>Step 2</B> — putting your classes
        on your conflict calendar. Everything else works without you. That
        doesn&rsquo;t.
      </Callout>

      <Section title="Step 1 · Sign in, and tick the calendar boxes">
        <p>
          Sign in with the Google account you use for PADT. Google will show a
          screen listing what the app is asking for.
        </p>
        <p>
          <B>
            Every permission on that screen has its own tick-box, and they are
            not ticked for you.
          </B>{" "}
          Tick the calendar ones before you press Continue.
        </p>
        <p>
          If you skip them you&rsquo;ll still get in and everything will look
          fine — but your conflicts won&rsquo;t import, and the only way to fix
          it is to sign out and sign back in. It&rsquo;s much easier to tick
          them now.
        </p>
      </Section>

      <Section title="Step 2 · Put your classes on your conflict calendar">
        <p>
          You were given a <B>PADT conflict calendar</B>{" "}in Google Calendar.
          That calendar is how you tell the schedule when you can&rsquo;t
          dance. Put your classes, work shifts, labs, other rehearsals and
          anything else recurring on it.
        </p>
        <p>Then link it to this app, once:</p>
        <ol>
          <li>
            Open <Nav href="/conflicts">My Conflicts</Nav>
          </li>
          <li>
            Press <B>Choose my calendar</B>{" "}and pick your PADT conflict
            calendar from the list
          </li>
          <li>
            Press <B>Sync the whole term</B>
          </li>
        </ol>
        <p>
          After that, keep the Google calendar up to date and press Sync again
          whenever something changes. You never have to type a conflict twice.
        </p>
        <p>
          <B>One catch:</B>{" "}a conflict needs a start and end time. An all-day
          entry doesn&rsquo;t say which part of the day you&rsquo;re busy, so
          it can&rsquo;t be used — the app will tell you how many it had to
          skip. If you&rsquo;re away for whole days, use the away option rather
          than an all-day event.
        </p>
      </Section>

      <Section title="Step 3 · Add it to your home screen">
        <p>
          On an iPhone: tap <B>Share</B>, then <B>Add to Home Screen</B>. On
          Android, Chrome offers <B>Install app</B>.
        </p>
        <p>
          This isn&rsquo;t tidiness. A website can only send you notifications
          once it&rsquo;s on your home screen — that&rsquo;s Apple&rsquo;s
          rule, not ours. Without it you won&rsquo;t get the nudge when a
          schedule is posted or when practice is starting.
        </p>
      </Section>

      <Section title="Step 4 · Submit your week">
        <p>
          Each week, once your conflicts are in, press <B>Submit</B>{" "}on{" "}
          <Nav href="/conflicts">My Conflicts</Nav>.
        </p>
        <p>
          This matters more than it looks. Without it the AD can&rsquo;t tell
          &ldquo;this person has no conflicts this week&rdquo; from &ldquo;this
          person hasn&rsquo;t looked yet&rdquo; — and the difference decides
          whether the week can be scheduled or everybody gets chased.
        </p>
        <p>
          Submitting doesn&rsquo;t lock anything. Remember a class on Wednesday?
          Add it. Your week stays submitted.
        </p>
        <p>
          To check a different week, use the date bar at the top of the page:
          the single arrows move a week, the double arrows move a month, and
          the date box jumps straight to any week you pick.
        </p>
      </Section>

      <Section title="Step 5 · Get your rehearsals into your own calendar">
        <p>
          On <Nav href="/schedule">My Schedule</Nav>, press{" "}
          <B>Add all to my calendar</B>. Every rehearsal you&rsquo;re called to,
          for the whole term, goes into your Google Calendar in one press.
        </p>
        <p>
          Press it again any time the schedule changes — it updates what&rsquo;s
          already there instead of adding duplicates, and removes anything that
          got cancelled. There&rsquo;s a <B>Take them back out</B>{" "}button if you
          change your mind.
        </p>
      </Section>

      <Section title="Step 6 · Check in at practice">
        <p>
          When a practice starts, a <B>Check in</B>{" "}button appears on{" "}
          <Nav href="/schedule">My Schedule</Nav>. Tap it when you arrive.
          That&rsquo;s your attendance.
        </p>
        <p>
          Late is not the same as absent here. If you check in after the start
          time you&rsquo;re marked late, not missing. If you know in advance
          you&rsquo;ll be late, say so and it&rsquo;s recorded as expected
          rather than counted against you.
        </p>
        <p>
          Your own record is on{" "}
          <Nav href="/my-attendance">My Attendance</Nav>. Nobody else&rsquo;s
          record is visible to you.
        </p>
      </Section>

      {choreographs && (
        <Section title="If you choreograph a dance">
          <p>
            You get two extra things, and they only cover your own dances.
          </p>
          <ul>
            <li>
              <B>Cast conflicts</B> — see what your dancers have logged for the
              week, so you know who the schedule is working around.
            </li>
            <li>
              <B>Attendance</B> — tick off who came after a practice, then
              submit it. Until you submit, it&rsquo;s provisional. There&rsquo;s
              no deadline.
            </li>
          </ul>
          <p>
            You count more than a dancer when the app is choosing a time. If
            your dance has several choreographers, one of you being busy barely
            affects it — the others can run it. If <B>none</B>{" "}of you can make a
            slot, the app pushes that slot to the bottom of the list, because
            there&rsquo;d be nobody to run the rehearsal.
          </p>
        </Section>
      )}

      <Section title="What happens on the other side">
        <p>
          Worth knowing, because it explains why the steps above matter.
        </p>
        <ul>
          <li>
            <B>Rooms come from a Google calendar, not from guesswork.</B>{" "}A
            room only exists as an option when somebody has actually booked it.
            The app can&rsquo;t offer time nobody reserved.
          </li>
          <li>
            <B>The app suggests, a person decides.</B>{" "}It ranks the times by how
            much of the cast can make it and shows who can&rsquo;t and why. The
            AD picks.
          </li>
          <li>
            <B>Nothing reaches you until it&rsquo;s published.</B>{" "}The AD works
            in drafts. You are told once — when a schedule is published — not
            every time something is moved around behind the scenes.
          </li>
          <li>
            <B>Your conflicts are marked excused or unexcused by the AD</B>, not
            by you. A class and a nap aren&rsquo;t the same thing, and that call
            isn&rsquo;t yours to make. Both still count when choosing a time.
          </li>
          <li>
            <B>A conflict is not a no.</B>{" "}If a time is the best available, it
            may be picked anyway — with your conflict visible next to it. That
            is why writing what it actually is (&ldquo;CHEM 101 lab&rdquo;)
            helps more than leaving it blank.
          </li>
          <li>
            <B>Every dance getting a rehearsal comes first.</B>{" "}A dance with no
            practice doesn&rsquo;t rehearse at all, so if fitting one more
            dance in means your practice lands at a time one or two people
            can&rsquo;t make, that&rsquo;s the trade the scheduler takes. Your
            conflict is still recorded and still visible to the AD — you
            aren&rsquo;t marked absent for something you told them about.
          </li>
        </ul>
      </Section>

      <Section title="When something looks wrong">
        <ul>
          <li>
            <B>&ldquo;This account didn&rsquo;t grant calendar access&rdquo;</B>{" "}
            — you skipped the tick-boxes at Step 1. Sign out, sign back in, tick
            them.
          </li>
          <li>
            <B>Sync says it found nothing</B> — either you picked the wrong
            calendar, or your conflicts are outside the dates it searched. The
            message tells you which dates it looked at.
          </li>
          <li>
            <B>Sync imported nothing but found events</B> — they&rsquo;re
            probably all-day entries. Give them real times.
          </li>
          <li>
            <B>A rehearsal is in the app but not your Google Calendar</B> —
            press <B>Add all to my calendar</B>{" "}on My Schedule.
          </li>
          <li>
            <B>Anything else</B> — tell the AD what the screen said. The
            messages are written to name the thing that needs changing.
          </li>
        </ul>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="mb-2 font-semibold text-ink">
        {title}
      </h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-ink-soft [&_li]:ml-4 [&_li]:list-disc [&_ol_li]:list-decimal [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-1 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1">
        {children}
      </div>
    </section>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm leading-relaxed text-accent-ink">
      {children}
    </p>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-semibold text-ink">
      {children}
    </strong>
  );
}

function Nav({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-accent-ink hover:underline">
      {children}
    </Link>
  );
}
