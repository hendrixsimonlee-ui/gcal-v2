import Link from "next/link";

/** The AD's manual: what every screen is for, and — the part that actually
 * gets asked — how the scheduler decides.
 *
 * Written plainly on purpose. An AD who can't explain why a slot was
 * suggested can't defend the schedule to a choreographer who doesn't like it,
 * and will end up ignoring the tool and doing it by hand. */
export default function AdminHelpPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">How it all works</h1>
        <p className="mt-1 text-sm text-ink-soft">
          What each screen does, and exactly how the scheduler picks times — in
          plain terms, so you can explain any suggestion it makes.
        </p>
      </div>

      <Section title="The shape of the whole thing">
        <ol>
          <li>
            <B>Rooms</B>{" "}come in from one Google calendar you point at.
          </li>
          <li>
            <B>Conflicts</B>{" "}come in from each dancer&rsquo;s own conflict
            calendar.
          </li>
          <li>
            <B>You</B>{" "}pick times, helped by a ranked list.
          </li>
          <li>
            <B>Publishing</B>{" "}is what tells everybody. Nothing before that
            reaches them.
          </li>
          <li>
            <B>Attendance</B>{" "}is checked off after, and feeds back in as a
            tie-breaker if you want it to.
          </li>
        </ol>
      </Section>

      <Section title="Spaces — where rooms come from">
        <p>
          One Google calendar holds every room booking the team has. On{" "}
          <Nav href="/admin/spaces">Spaces</Nav> you link it once and press
          Sync.
        </p>
        <p>The app reads each event as:</p>
        <ul>
          <li>
            <B>Title</B> = the room&rsquo;s name
          </li>
          <li>
            <B>Location</B> = where it is
          </li>
          <li>
            <B>Start and end</B> = when that room is yours
          </li>
        </ul>
        <p>
          So the calendar needs to be a list of room bookings, not a list of
          events. An event titled &ldquo;GBM #1&rdquo; creates a room called
          &ldquo;GBM #1&rdquo;. Titles are taken exactly as written — &ldquo;EM
          SACHS&rdquo; and &ldquo;Em Sachs&rdquo; are two different rooms.
        </p>
        <p>
          It&rsquo;s a mirror, not a merge: delete the event in Google and the
          booking disappears here too. All-day entries are skipped, because
          they don&rsquo;t say what hours you actually have.
        </p>
        <p>
          <B>The consequence worth remembering:</B>{" "}the app can never suggest a
          time in a room nobody booked. If suggestions look thin, the spaces
          calendar is usually the reason.
        </p>
      </Section>

      <Section title="Conflicts — where availability comes from">
        <p>
          Each person links their own PADT conflict calendar and syncs it. You
          can also link and sync on their behalf from{" "}
          <Nav href="/admin/dancer-calendars">Dancer Calendars</Nav>, which is
          the practical way to set up a term without forty people each doing it
          right.
        </p>
        <p>
          On <Nav href="/admin/conflicts">Conflict Review</Nav> you mark each
          one <B>excused</B>{" "}or <B>unexcused</B>. Both still count against a
          time; excused just counts less. Anything you haven&rsquo;t reviewed is
          treated as unexcused, so unreviewed conflicts never quietly make a
          slot look better than it is.
        </p>
        <p>
          <B>Submitting</B>{" "}is how somebody says &ldquo;I&rsquo;ve looked at
          this week&rdquo;. It&rsquo;s what separates a genuinely free week from
          one nobody checked. If people haven&rsquo;t submitted you can nudge
          them, or submit on their behalf — that&rsquo;s recorded as submitted
          by you, so you can still tell who actually replied.
        </p>
      </Section>

      <Section title="The scheduler, step by step">
        <p>
          This is the part people ask about. It runs the same way whether
          you&rsquo;re looking at one dance or pressing Build the week.
        </p>

        <h3 className="mt-2 font-semibold text-ink">
          Step 1 — Find every possible slot
        </h3>
        <p>
          It takes each room booking and slides a window of your practice length
          across it in 30-minute steps. A 6–9pm booking with a 90-minute
          practice gives 6:00, 6:30, 7:00 and 7:30 starts. The practice has to
          fit entirely inside the booking, so a 2-hour practice in a 90-minute
          booking gives nothing.
        </p>
        <p>
          Practice length comes from the dance&rsquo;s{" "}
          <B>usual practice length</B>, set on{" "}
          <Nav href="/admin/dances">Dances</Nav>, in 15-minute steps. You can
          override it for a single search with the Minutes box in the builder.
        </p>

        <h3 className="mt-2 font-semibold text-ink">
          Step 2 — Throw out the impossible ones
        </h3>
        <p>Only two things make a slot impossible:</p>
        <ul>
          <li>The room isn&rsquo;t yours for the whole window</li>
          <li>
            Another dance is already in that room then — drafts included, since
            a draft holds its room
          </li>
        </ul>
        <p>
          <B>Nothing else is ever removed.</B>{" "}Everything else is a weight, so
          you always get the least-bad options rather than an empty list.
        </p>

        <h3 className="mt-2 font-semibold text-ink">
          Step 3 — Set aside anyone who&rsquo;s away
        </h3>
        <p>
          Someone out of town misses <em>every</em> slot that week equally, so
          counting them can&rsquo;t change which slot is best — it would only
          make every option look bad. They&rsquo;re listed separately as
          &ldquo;away&rdquo; so you can still see the real headcount.
        </p>

        <h3 className="mt-2 font-semibold text-ink">
          Step 4 — Score what&rsquo;s left, lowest wins
        </h3>
        <table className="my-1 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th className="py-1 pr-3 font-medium text-ink">Situation</th>
              <th className="py-1 font-medium text-ink">Cost</th>
            </tr>
          </thead>
          <tbody className="[&_td]:py-1 [&_td]:pr-3 [&_tr]:border-b [&_tr]:border-line/60">
            <tr>
              <td>Dancer has an unexcused conflict</td>
              <td className="tabular-nums">2</td>
            </tr>
            <tr>
              <td>Dancer has a conflict you haven&rsquo;t reviewed yet</td>
              <td className="tabular-nums">2</td>
            </tr>
            <tr>
              <td>Dancer has an excused conflict</td>
              <td className="tabular-nums">1</td>
            </tr>
            <tr>
              <td>Dancer is called to another dance at the same time</td>
              <td className="tabular-nums">2</td>
            </tr>
            <tr>
              <td>
                Dancer usually skips this weekday (only above 50%, only if the
                Settings toggle is on)
              </td>
              <td className="tabular-nums">up to 1</td>
            </tr>
            <tr>
              <td>One choreographer can&rsquo;t make it, others can</td>
              <td className="tabular-nums">3</td>
            </tr>
            <tr>
              <td>
                <B>No choreographer at all can make it</B>
              </td>
              <td className="tabular-nums">
                <B>10 × cast size + 50</B>
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          That last row is the important one. For a 12-person dance it&rsquo;s
          170 points — more than the entire cast could ever add up to. So a slot
          with nobody to run the rehearsal always loses to any slot that has
          somebody, however many dancers are missing from it. It scales with
          cast size so it works the same for a dance of 6 and a dance of 25.
        </p>
        <p>
          But one choreographer out of three being busy costs only 3, roughly a
          dancer and a half. If two of them can still run it, that&rsquo;s a
          perfectly ordinary slot and it&rsquo;s treated as one.
        </p>
        <p>
          <B>And a leaderless slot is still shown.</B>{" "}It sits at the bottom of
          the list, labelled. The app never tells you a week can&rsquo;t be
          scheduled — it shows you the least-bad option and lets you decide.
        </p>

        <h3 className="mt-2 font-semibold text-ink">Step 5 — Rank</h3>
        <p>
          Lowest score first, ties to the earlier slot, at most 2 suggestions
          per day (so one evening doesn&rsquo;t fill the list in 30-minute
          strips), top 8 shown.
        </p>
      </Section>

      <Section title="Build the week — placing every dance at once">
        <p>
          Same scoring, plus the problem of dances competing with each other.
        </p>
        <ol>
          <li>
            Takes every dance not already scheduled that week and not marked off
          </li>
          <li>
            Goes <B>most-constrained-first</B> — the dance with the fewest
            options picks first, bigger cast breaks ties. A dance with one
            workable slot must not lose it to a dance that had five.
          </li>
          <li>
            Gives each dance its best remaining slot, judged by how many people
            can come
          </li>
          <li>
            Refuses any placement that clashes with one already made — same
            room, or dancers shared between the two dances
          </li>
          <li>
            Then tries swapping pairs of placements to see if the total turnout
            improves
          </li>
        </ol>
        <p>
          If the historical toggle is on, someone who keeps missing{" "}
          <em>that particular dance</em> counts slightly more than one head, so
          ties break toward including the person who keeps getting left out. It
          only ever breaks ties — it never outvotes people who actually said
          they&rsquo;re busy.
        </p>
        <p>
          Everything it produces is a <B>draft</B>. Nobody is told anything
          until you publish. The proposal itself isn&rsquo;t saved — it lives
          in the page until you press <B>Add these as drafts</B>, and those
          drafts then persist through refreshes and sign-outs like anything
          else.
        </p>

        <h3 className="mt-2 font-semibold text-ink">Which week it builds</h3>
        <p>
          The week the calendar is showing — not today&rsquo;s week. Page
          forward three weeks and press the button and you get that week.
          Weeks in the past work the same way, which is what you want when
          filling in a schedule after the fact.
        </p>

        <h3 className="mt-2 font-semibold text-ink">Giving a dance first pick</h3>
        <p>
          Each dance in the week checklist has a <B>First pick</B> box. Ticked,
          that dance chooses its slot before all the others, so it gets the
          best time available and everyone else works around it. Use it for
          the week a piece has to have full attendance.
        </p>
        <p>
          It applies to <B>that week only</B> and clears itself as the week
          passes, so a preference set in September can&rsquo;t quietly skew
          December.
        </p>

        <h3 className="mt-2 font-semibold text-ink">Building a week twice</h3>
        <p>
          Pressing the button again is safe: dances already placed are left
          alone and only the gaps get filled. That also means ticking First
          pick <em>after</em> you&rsquo;ve built a week changes nothing on its
          own, because there is nothing left to place.
        </p>
        <p>
          <B>Clear drafts and rebuild</B> is the way to make it reconsider. It
          throws away this week&rsquo;s drafts and solves the whole week again
          from scratch. Published practices are never touched — they keep their
          rooms and the rebuild works around them.
        </p>
      </Section>

      <Section title="Publishing and notifications">
        <p>The rule is simple: publishing is what notifies.</p>
        <ul>
          <li>Drafts are invisible to everyone but you.</li>
          <li>
            Publishing a week tells that week&rsquo;s cast, once.
          </li>
          <li>
            Editing something already published <B>stages</B>{" "}the change — it
            doesn&rsquo;t send. You choose when to announce it.
          </li>
          <li>
            Putting a published practice back into draft doesn&rsquo;t notify
            anybody either.
          </li>
        </ul>
        <p>
          This is deliberate. An earlier, chattier version notified on every
          change and the team stopped reading any of it.
        </p>
      </Section>

      <Section title="Attendance">
        <p>
          Choreographers tick off their own dances; you can do any of them.
          Until it&rsquo;s submitted it&rsquo;s provisional, and there&rsquo;s
          no deadline.
        </p>
        <p>
          Late and absent are different states. Someone who checks in after the
          start is late; someone who told you in advance they&rsquo;d be late is
          recorded as expected. Anyone you excluded from a week is marked
          excused rather than absent, so leaving someone out never damages their
          record.
        </p>
        <p>
          <Nav href="/admin/attendance">Attendance Review</Nav> shows the
          cumulative picture and flags chronic absence at whatever threshold you
          set in Settings.
        </p>
      </Section>

      <Section title="Things that surprise people">
        <ul>
          <li>
            <B>Everything runs on Eastern time</B>, whatever device you&rsquo;re
            on.
          </li>
          <li>
            <B>Ticking someone out of a week is recorded</B>, with the reason,
            and shows on their attendance as excused. It isn&rsquo;t a quiet
            what-if.
          </li>
          <li>
            <B>A draft holds its room.</B>{" "}That&rsquo;s why a slot can vanish
            from the suggestions after you place something.
          </li>
          <li>
            <B>Archived dances are out of the picture entirely</B> — they
            don&rsquo;t hold rooms or count as clashes.
          </li>
          <li>
            <B>Terms control every date range.</B>{" "}If a sync finds nothing,
            check the term dates in{" "}
            <Nav href="/admin/settings">Settings</Nav> before anything else.
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
      <h2 className="mb-2 font-semibold text-ink">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-ink-soft [&_li]:ml-4 [&_li]:list-disc [&_ol_li]:list-decimal [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-1 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1">
        {children}
      </div>
    </section>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>;
}

function Nav({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-accent-ink hover:underline">
      {children}
    </Link>
  );
}
