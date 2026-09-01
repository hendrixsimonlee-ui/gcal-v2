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
        <p>
          Those two numbers — 8 and 2 a day — are only about keeping the list
          on screen readable.{" "}
          <B>Build the week works from every legal slot, not the top 8.</B> It
          has to: it places dances one after another, and each one it places
          takes options away from the dances still to come. This is what used
          to make a dance come back as{" "}
          <em>&ldquo;every workable slot clashes with another dance&rdquo;</em>{" "}
          when opening that same dance on its own showed you several perfectly
          good times.
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
            <B>Goes back for anything it couldn&rsquo;t fit</B> and asks up to
            two dances already placed to move over, if they have somewhere else
            to go
          </li>
          <li>
            Then tries swapping pairs of placements to see if the total turnout
            improves
          </li>
          <li>
            <B>Hands each slot to the dance that gets the most out of it</B> —
            if a time would give one dance its whole cast and the dance sitting
            on it has somewhere else just as good, they trade
          </li>
          <li>
            <B>Does all of that several times from different starting orders</B>{" "}
            and keeps the best week it found
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

        <h3 className="mt-2 font-semibold text-ink">
          Every dance getting a time beats everyone making every time
        </h3>
        <p>
          A dance with no rehearsal rehearses not at all. A dance at a time two
          people can&rsquo;t make still rehearses. So when the builder runs out
          of room for a dance, it doesn&rsquo;t give up — it looks at whichever
          dance is in the way and checks whether that one has anywhere else to
          go. If it does, it moves, and both dances end up on the schedule.
        </p>
        <p>
          <B>The dance that moves may land somewhere slightly worse for its
          own cast</B>, and that is on purpose. If you&rsquo;d rather it
          didn&rsquo;t move, tick First pick on it: a dance with First pick is
          never the one asked to shift.
        </p>
        <p>
          It will move <B>up to two</B> dances to make room. Three would cost
          more time than it buys and would leave you unable to explain to a
          choreographer why their practice moved, so it stops there.
        </p>
        <p>
          If a dance is still listed as unplaced afterwards, it now genuinely
          means there was nowhere for it — the builder already searched every
          slot in the week and already tried moving things out of its way.
        </p>

        <h3 className="mt-2 font-semibold text-ink">
          Who gets a contested slot
        </h3>
        <p>
          A time goes to <B>whichever dance gets the most out of it</B>, not
          whichever happened to be placed first. If 7pm Tuesday would give one
          dance its whole cast, and the dance currently sitting on it is just
          as happy at 8:30, they trade.
        </p>
        <p>
          The trade only happens when the two of them come out ahead together.
          A dance that would gain one person can&rsquo;t push aside a dance
          that would lose three — so the bigger loss always wins the argument,
          and nothing gets shunted somewhere worse to suit a dance that gains
          less.
        </p>
        <p>
          A dance marked <B>First pick</B> is never the one asked to trade.
        </p>

        <h3 className="mt-2 font-semibold text-ink">
          It solves the week several times and keeps the best
        </h3>
        <p>
          Placing most-constrained-first is a good rule, not a perfect one — it
          can back itself into a corner that a different starting order walks
          straight past. So the builder solves the whole week{" "}
          <B>up to 12 times over</B> from different orders and keeps whichever
          result comes out best: more dances placed wins first, and if two are
          level on that, more people expected wins.
        </p>
        <p>
          <B>This can only help, never hurt.</B> The first run is always the
          normal ordering, and another run has to be <em>strictly</em> better
          to replace it. If none of them beat it, you get the same answer you
          would have got anyway.
        </p>
        <p>
          <B>Pressing Build twice gives the same schedule.</B> The extra runs
          vary how the builder searches, not what it decides, so the same week
          with the same conflicts always comes out the same. If the answer
          changes, something in the data changed — a new conflict, a published
          practice, a First pick tick.
        </p>
        <p>
          It stops early once every dance has a time, and it has a time limit,
          so the button stays quick. On a normal week it&rsquo;s a fraction of
          a second.
        </p>

        <h3 className="mt-2 font-semibold text-ink">
          The four reasons a dance can still come back unplaced
        </h3>
        <p>
          Each one has a different fix, so the builder names which one it hit
          next to the dance. In order of how often you&rsquo;ll see them:
        </p>
        <table className="my-1 w-full border-collapse text-left">
          <tbody className="[&_td]:py-1 [&_td]:pr-3 [&_td]:align-top [&_tr]:border-b [&_tr]:border-line/60">
            <tr>
              <td>
                <B>Its dancers are in another practice then</B>
              </td>
              <td>
                Nobody can be in two rooms at once. Move or delete the other
                practice, or leave this dance for next week.
              </td>
            </tr>
            <tr>
              <td>
                <B>The room is taken</B>
              </td>
              <td>
                Another dance holds every room this one could use, and has
                nowhere else to go. Book more room time, or shorten the
                practice.
              </td>
            </tr>
            <tr>
              <td>
                <B>Three or more dances are in the way</B>
              </td>
              <td>
                It moves at most two aside. Tick First pick on this dance and
                rebuild so it chooses before the others.
              </td>
            </tr>
            <tr>
              <td>
                <B>Blocked by a First pick dance</B>
              </td>
              <td>
                A dance you flagged is holding the only workable time, and
                flagged dances are never moved. Untick it and rebuild.
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          A fifth message, <B>&ldquo;nowhere to put it&rdquo;</B>, means there
          was no legal slot at all — no room booked long enough that week, or
          every open hour already taken. Check the spaces calendar.
        </p>

        <h3 className="mt-2 font-semibold text-ink">
          Why a dance can look schedulable on its own page but not here
        </h3>
        <p>
          This is the one that looks like a bug and isn&rsquo;t, so it&rsquo;s
          worth knowing before somebody asks you.
        </p>
        <p>
          <B>Best times this week</B> and <B>Build the week</B> treat one thing
          differently on purpose. If some of a dance&rsquo;s cast are in
          another dance&rsquo;s practice at 7pm, the suggestion list still
          shows you 7pm — with the clash marked and those people named —
          because you may well decide to hold the rehearsal without them. The
          week builder can&rsquo;t use that time at all, because it is placing
          both practices and can&rsquo;t put the same person in two rooms.
        </p>
        <p>
          So a dance can be listed as unplaced while its own page offers
          several times that look fine. Those slots are tagged{" "}
          <B>&ldquo;Build the week can&rsquo;t use this one&rdquo;</B> in the
          suggestion list, and the unplaced message says the same thing from
          the other side. If you want the rehearsal anyway, press{" "}
          <B>Use this slot</B> — the builder is deferring to you, not
          overruling you.
        </p>
        <p>
          The tell: look at <em>why</em> people are missing. &ldquo;In another
          dance then&rdquo; is a hard clash the builder must refuse. A logged
          conflict like &ldquo;CHEM 101 lab&rdquo; is not — the builder will
          happily use that time if it&rsquo;s the best one going.
        </p>
        <p>
          <B>Check the Minutes box too.</B> The suggestion list uses whatever
          length is in that box; Build the week always uses the dance&rsquo;s
          saved length. Type 60 into it for a 90-minute dance and you&rsquo;ll
          see times that don&rsquo;t exist at 90, which looks like the builder
          missing them. Switching dances resets it automatically, and a warning
          appears next to the box whenever the two differ.
        </p>

        <h3 className="mt-2 font-semibold text-ink">
          Packing rooms — no stranded half-hours
        </h3>
        <p>
          The club has a fixed number of booked hours, and a 30-minute hole
          between two rehearsals in the same room is time nobody can use.
          So when two slots are otherwise level, the builder prefers the one
          that starts exactly when the previous practice ends, and avoids one
          that would leave a gap of <B>45 minutes or less</B>. A longer gap is
          fine — you can still book into it.
        </p>
        <p>
          It counts practices already in the room too, published ones and
          drafts alike, not just what it&rsquo;s placing this run.
        </p>
        <p>
          This is a tie-breaker and nothing more —{" "}
          <B>it is worth less than one person&rsquo;s attendance</B>, so a
          tidier room can never beat a time more of the cast can actually make.
        </p>

        <h3 className="mt-2 font-semibold text-ink">Which week it builds</h3>
        <p>
          The week the calendar is showing — not today&rsquo;s week. Page
          forward three weeks and press the button and you get that week.
          Weeks in the past work the same way, which is what you want when
          filling in a schedule after the fact.
        </p>
        <p>
          The button says which week it will act on —{" "}
          <B>Build Sep 14 – Sep 20 for me</B> — and retitles itself as you move
          around, so it can&rsquo;t quietly run on a week you paged away from.
        </p>

        <h3 className="mt-2 font-semibold text-ink">Giving a dance first pick</h3>
        <p>
          Each dance in the week checklist has a <B>First pick</B> box. Ticked,
          that dance chooses its slot before all the others, so it gets the
          best time available and everyone else works around it. Use it for
          the week a piece has to have full attendance.
        </p>
        <p>
          It does one more thing: a First pick dance is{" "}
          <B>never the one moved aside</B> when the builder is trying to fit a
          leftover dance in. Everything else can be asked to shift; this one
          keeps the slot it chose.
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

      <Section title="What the team can do on their side">
        <p>
          Worth knowing so you can answer it without checking, since these are
          the two things people ask about most.
        </p>
        <ul>
          <li>
            <B>Getting rehearsals into their own calendar.</B>{" "}On My Schedule
            there is <B>Add all to my calendar</B>, which puts every rehearsal
            they&rsquo;re called to for the whole term into their Google
            Calendar in one press. Safe to press again after you reschedule —
            it updates what&rsquo;s there rather than adding duplicates, and
            removes anything cancelled.
          </li>
          <li>
            <B>The calendar permission is a separate tick-box.</B>{" "}Google&rsquo;s
            consent screen lists each permission with its own box, unticked by
            default, so somebody can finish signing in with no calendar access
            at all. Their conflicts then silently never import.{" "}
            <Nav href="/admin/dancer-calendars">Dancer Calendars</Nav> flags
            anyone in that state as{" "}
            <B>Didn&rsquo;t grant calendar access</B>, and the fix is for them
            to sign out, sign back in, and tick the boxes. Worth checking that
            screen at the start of a term rather than finding out when a
            rehearsal lands on somebody&rsquo;s midterm.
          </li>
        </ul>
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

      <Section title="Reading the Schedule Builder">
        <ul>
          <li>
            <B>Drafts are hatched with diagonal stripes and a dashed
            border</B>{" "}and carry a DRAFT badge; published practices are
            solid blocks. Both keep their dance&rsquo;s colour. Publishing is
            what notifies people, so the difference has to be visible at a
            glance — mistaking one for the other is how somebody gets told
            about a rehearsal that isn&rsquo;t happening.
          </li>
          <li>
            <B>Each dance in the checklist shows expected turnout</B>{" "}—
            &ldquo;8/8 expected&rdquo;. Green means the whole cast can make it,
            amber means somebody can&rsquo;t. Click it to see who and why,
            without leaving the page. Choreographers are listed first, since a
            missing one changes whether the rehearsal is worth holding.
          </li>
          <li>
            The builder has the same date bar as the other screens, plus
            FullCalendar&rsquo;s own week and month views.
          </li>
        </ul>
      </Section>

      <Section title="Getting rid of drafts">
        <ul>
          <li>
            <B>One draft at a time per dance.</B>{" "}Placing a second slot for a
            dance that already has an unpublished one replaces it rather than
            adding another — a second placement is a change of mind, not a
            second rehearsal. Two drafts for the same piece told you nothing
            about which was meant, and the older one quietly held its room
            against every later suggestion.
          </li>
          <li>
            <B>The × beside a draft deletes it</B>{" "}on the spot, straight from
            the checklist. No opening the practice first.
          </li>
          <li>
            <B>Clear all drafts for this week</B>{" "}empties the week in one
            press — the way to start a build over.
          </li>
          <li>
            All three touch <em>drafts only</em>. A published practice has
            already been announced, so removing it is a cancellation that
            messages the cast, and that stays its own deliberate action.
          </li>
          <li>
            Need a genuine second rehearsal in one week? Publish the first,
            then place the next — publishing frees the dance to hold a new
            draft.
          </li>
        </ul>
      </Section>

      <Section title="Moving between weeks">
        <p>
          Conflict Review, Spaces and My Conflicts all carry the same date bar,
          pinned to the top of the page so the week you&rsquo;re looking at
          stays visible as you scroll.
        </p>
        <ul>
          <li>
            <B>&lsaquo;</B> and <B>&rsaquo;</B> move a week;{" "}
            <B>&lsaquo;&lsaquo;</B> and <B>&rsaquo;&rsaquo;</B> move a whole
            month, so a week six weeks out is two clicks rather than six.
          </li>
          <li>
            The <B>date box</B> jumps straight to whichever week contains the
            date you pick — the quickest way to &ldquo;the week of the
            showcase&rdquo;.
          </li>
          <li>
            <B>This week</B> appears once you&rsquo;ve moved away, to get back.
          </li>
          <li>
            Every week is a real link, so you can bookmark one or use the back
            button.
          </li>
        </ul>
        <p>
          The Schedule Builder has the same bar, and its grid keeps
          FullCalendar&rsquo;s own week and month views as well.
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
