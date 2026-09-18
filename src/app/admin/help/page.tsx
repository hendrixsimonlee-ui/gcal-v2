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

      {/* Same handbook as the dancer page links to; its second half is this
          screen's content in full, including every number the scheduler
          uses. Shareable, so exec can read it without an admin account. */}
      <a
        href="https://claude.ai/artifact/DKDUEU9wjpKChdsh4DA5Uv"
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-col gap-0.5 rounded-lg border border-accent/40 bg-accent-soft px-4 py-3 no-underline transition-colors hover:border-accent"
      >
        <span className="text-sm font-semibold text-accent-ink">
          The full handbook &rarr;
        </span>
        <span className="text-xs text-ink-soft">
          The complete write-up, dancer half and AD half, in one shareable
          page. Send it to exec rather than explaining the scheduler again.
        </span>
      </a>

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

      <Section title="Getting the team onto notifications">
        <p>
          You will be asked about this, so it&rsquo;s worth knowing the shape
          of it. <B>Notifications are the only way the app reaches anybody.</B>{" "}
          There is no email.
        </p>
        <p>It takes two steps on a phone, and people stop after the first:</p>
        <ol>
          <li>
            Add PADT to the home screen. On an iPhone nothing can be sent until
            they do, because Apple won&rsquo;t deliver to a browser tab.
          </li>
          <li>
            Open it from the home screen and answer <B>Turn on
            notifications?</B>
          </li>
        </ol>
        <p>
          <B>The app now asks them itself, on every screen, every time they
          open it</B>, until they answer one way or the other. They can press
          Not now as often as they like and it comes back next time. So
          &ldquo;I never got told&rdquo; should become rare, and when it
          happens the usual cause is step 1.
        </p>
        <p>
          <B>If nobody on the team has notifications</B>, it isn&rsquo;t the
          team. Push needs three settings on the server:{" "}
          <code>VAPID_PUBLIC_KEY</code>, <code>VAPID_PRIVATE_KEY</code>{" "}and{" "}
          <code>VAPID_SUBJECT</code>. Without them the app tells people their
          browser can&rsquo;t do notifications, which blames the wrong thing.
          Check those first.
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
          one <B>excused</B>{" "}or <B>unexcused</B>.{" "}
          <B>Both count the same against a time</B>{" "}— an absence is an
          absence, and whether you excused it doesn&rsquo;t change who is
          standing in the room. The mark is still worth making: it&rsquo;s what
          attendance records go on, and it tells you at a glance whether a
          clash is a lab or something soft. Anything unreviewed counts too, so
          it can never quietly make a slot look better than it is.
        </p>
        <p>
          <B>Both conflict screens open on next week</B>, yours and theirs, and
          roll over every Monday at 6am. The schedule is built a week ahead, so
          the week worth looking at on Thursday is the one starting the
          following Monday — the same week the reminders chase, so you and the
          team are never looking at different weeks while talking to each
          other. The date bar still moves freely and any week can still be
          submitted.
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
        <p>Three things make a slot impossible:</p>
        <ul>
          <li>The room isn&rsquo;t yours for the whole window</li>
          <li>
            Another dance is already in that room then — drafts included, since
            a draft holds its room
          </li>
          <li>
            <B>No choreographer for this dance can make it.</B>{" "}A rehearsal
            with nobody to run it isn&rsquo;t a rehearsal. One of three being
            busy is fine; all of them is not. (Unless you&rsquo;ve excused them
            for the week — see Step 3.)
          </li>
        </ul>
        <p>
          <B>Nothing else is ever removed.</B>{" "}Everything else is a weight, so
          you always get the least-bad options rather than an empty list.
        </p>

        <h3 className="mt-2 font-semibold text-ink">
          Step 3 — Score what&rsquo;s left, lowest wins
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
              <td className="tabular-nums">2</td>
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
              <td>
                <B>Refused</B>
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          <B>A time no choreographer can make is never offered and never
          drafted.</B>{" "}A rehearsal with nobody to run it isn&rsquo;t a
          rehearsal, so it isn&rsquo;t a score at all — it&rsquo;s a refusal,
          alongside &ldquo;the room isn&rsquo;t ours&rdquo; and
          &ldquo;another dance is already in it&rdquo;.
        </p>
        <p>
          <B>At least one is enough.</B>{" "}One choreographer out of three being
          busy costs 3, roughly a dancer and a half. If the other two can run
          it, that&rsquo;s an ordinary slot and it&rsquo;s treated as one — but
          a time all three can make still beats it, so the builder gathers as
          many as it can.
        </p>
        <p>
          <B>One exception, and you control it.</B>{" "}If every choreographer for
          a dance is excused for the week, the rule lifts — you&rsquo;ve
          already decided the dance runs without them, and refusing every slot
          would just make it unschedulable. Use the week tracker&rsquo;s excuse
          if you want a practice to go ahead leaderless.
        </p>
        <p>
          If that leaves a dance with nowhere to go, it says so in plain words —{" "}
          <em>&ldquo;there are open times, but no choreographer can make any of
          them&rdquo;</em>{" "}— rather than blaming the rooms.
        </p>

        <h3 className="mt-2 font-semibold text-ink">Step 4 — Rank</h3>
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
            Asks every unplaced dance <B>what it stands to lose by waiting</B>{" "}
            — the gap between its best remaining slot and its next two — and
            places whichever dance would lose most. A dance down to a single
            workable time has everything to lose, so it goes immediately.
          </li>
          <li>
            Gives that dance its best remaining slot, judged by who can come
          </li>
          <li>
            Refuses any placement that clashes with one already made — same
            room, or dancers shared between the two dances
          </li>
          <li>
            <B>Goes back for anything it couldn&rsquo;t fit</B> and asks up to
            three dances already placed to move over, if they have somewhere
            else to go
          </li>
          <li>
            Then tries swapping pairs of placements to see if the week improves
          </li>
          <li>
            <B>Hands each slot to the dance that gets the most out of it</B> —
            if a time would give one dance its whole cast and the dance sitting
            on it has somewhere else just as good, they trade
          </li>
          <li>
            <B>Tears three or four placements back out at random and rebuilds
            them</B>, over and over, keeping any version that comes out better.
            This is where most of the improvement comes from — it reaches
            arrangements no single swap can.
          </li>
          <li>
            <B>Starts the whole thing over from scratch</B>, again and again,
            for up to ten seconds, and keeps the best week it found
          </li>
        </ol>

        <h3 className="mt-2 font-semibold text-ink">
          What it is actually comparing
        </h3>
        <p>
          When the builder weighs two possible weeks against each other, it
          asks three questions <B>strictly in this order</B> and stops at the
          first one that gives a different answer:
        </p>
        <ol>
          <li>
            <B>How many dances got a time?</B> More wins, always, whatever it
            cost in attendance.
          </li>
          <li>
            <B>Who can&rsquo;t be there?</B> Fewer missing wins. A missing
            dancer counts 1, a missing choreographer counts 1.75, and anyone
            the history weighting has flagged counts up to 2.
          </li>
          <li>
            <B>How many booked minutes get stranded?</B> Fewer wins.
          </li>
        </ol>
        <p>
          <B>The order is the whole point.</B> Question 3 is only ever asked
          when two weeks are dead level on question 2. So a tidier set of rooms
          can never be chosen over a week more of the cast can make — there is
          no exchange rate between them, at any size.
        </p>
        <p>
          <B>How many rehearsals somebody has in a day isn&rsquo;t one of the
          questions.</B>{" "}Four in a day is treated as an ordinary week. The
          builder briefly scored it and it has been taken back out: people are
          in the dances they&rsquo;re in, and shuffling a week to even out
          somebody&rsquo;s Tuesday means fitting fewer dances into rooms the
          club has already paid for.
        </p>
        <p>
          The old version tried to do this with weights instead, keeping the
          room term deliberately small and hoping it stayed smaller than one
          person. It didn&rsquo;t, once, and the builder drafted a snug slot
          over a slot the whole cast was free for. Asking the questions in
          order removes the possibility rather than making it unlikely.
        </p>
        <p>
          <B>A note on the two sets of numbers.</B>{" "}The table further up is
          the single-dance list&rsquo;s scale, where a missing dancer costs 2
          and a missing choreographer costs 3. Build the week runs on its own
          scale, where a dancer costs 1 and a choreographer 1.75 — very
          slightly more weight on choreographers than the single-dance list
          gives them. Both say the same thing about what matters: a
          choreographer counts for more than a dancer, and two dancers still
          count for more than one choreographer. You will not see the
          difference in practice; it is written down here so that the two
          screens disagreeing by a fraction doesn&rsquo;t look like a bug.
        </p>
        <p>
          If the historical toggle is on, whoever keeps ending up as the one
          left out counts slightly more than one head, so ties break toward
          including them. It looks at <B>three things</B>, all worked out from
          the attendance you tick off — there is nothing to maintain:
        </p>
        <ul>
          <li>
            <B>How much of this dance they&rsquo;ve missed.</B>{" "}The direct
            answer, and worth 80% of the ordinary weighting. Ignored below one
            miss in five.
          </li>
          <li>
            <B>How much they&rsquo;ve missed this term across every dance
            they&rsquo;re in.</B>{" "}The other 20%. Somebody being squeezed out
            of four different dances a little at a time looks unremarkable in
            each one. Two misses in a term count for nothing; it&rsquo;s at
            full strength by eight.
          </li>
          <li>
            <B>How many of this dance they&rsquo;ve missed in a row, right
            now.</B>{" "}Not a share — this one is a ladder of its own, and it
            is the only part of the weighting that can outrank people who said
            they&rsquo;re busy. <B>Two weeks running makes them worth 2.5
            people. Three or more makes them worth 3.</B>
          </li>
        </ul>
        <p>
          <B>Why a run is treated differently.</B>{" "}A percentage can&rsquo;t
          break a streak. Somebody who has missed three weeks of one dance in a
          row still only reads as a fraction of a term, so they used to cap out
          at two heads — which ties two people missing for the first time and
          loses to two-and-a-bit. The builder would sacrifice them a fourth
          time, which is the exact pattern this whole feature exists to stop.
          So a run gets its own rung on the ladder and is allowed to win the
          argument.
        </p>
        <p>
          <B>It stops at three on purpose.</B>{" "}Three heads is enough to tie
          three people, deliberately not enough to beat them. Past that the
          builder starts producing weeks you can&rsquo;t defend — a practice at
          a time most of the cast can&rsquo;t make, to bring one person back.
        </p>
        <p>
          Everything except a run <B>only breaks ties</B>{" "}and tops out at
          two heads. Excused and unexcused both count throughout: the question
          is who keeps ending up unable to come, not whose reason was better.
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
          It will move <B>up to three</B> dances to make room, in a chain — A
          moves so B can move so C can fit. Four would cost more time than it
          buys, so it stops there. If you need to explain to a choreographer
          why their practice moved, the unplaced list names every dance that
          was involved.
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
          It solves the week hundreds of times and keeps the best
        </h3>
        <p>
          Placing the most desperate dance first is a good rule, not a perfect
          one — it can back itself into a corner that a different order walks
          straight past. So the builder solves the whole week over and over,
          from different randomised starting points, for <B>up to ten
          seconds</B>, and keeps whichever version answers the three questions
          above best.
        </p>
        <p>
          The result line tells you how many it got through —{" "}
          <B>best of 93 arrangements</B>. On a typical week that is somewhere
          in the dozens to low hundreds. A week that only managed a handful is
          a week worth looking over more carefully than usual.
        </p>
        <p>
          <B>This can only help, never hurt.</B> The first attempt is always
          the plain, un-randomised one, and a later attempt has to be{" "}
          <em>strictly</em> better to replace it. If none of them beat it, you
          get exactly the answer you would have got without the search.
        </p>
        <p>
          <B>Pressing Build twice gives the same schedule.</B> The randomness
          is seeded from the week itself, so it varies how the builder
          searches, not what it decides. If the answer changes, something in
          the data changed — a new conflict, a published practice, a First pick
          tick.
        </p>
        <p>
          It stops early in two cases: when there is nothing left to find —
          every dance placed, everybody able to come, no room time wasted — and
          when it has gone a long stretch without improving on the best week it
          has. So a straightforward week still returns almost instantly.
        </p>
        <p>
          <B>A hard week will use the whole ten seconds, and should.</B>{" "}The
          &ldquo;long stretch&rdquo; above scales with how many dances there
          are, because a fifteen-dance week has an enormous number of
          arrangements and its last improvement can come hundreds of attempts
          in. This used to be a flat number and it stopped an eighteen-dance
          test week after under three seconds, at which point running the full
          budget still found a better answer. If the button feels slow on a
          busy week, that is it doing the thing you asked for.
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
                <B>Four or more dances are in the way</B>
              </td>
              <td>
                It moves at most three aside. Tick First pick on this dance and
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
          No dance gets hollowed out
        </h3>
        <p>
          The builder is adding up people across the whole week, and addition
          doesn&rsquo;t know the difference between a rehearsal and a room with
          four people standing in it. Twelve down to four is &ldquo;only&rdquo;
          eight, and eight is a bargain if it buys nine somewhere else.
        </p>
        <p>
          So there&rsquo;s a hard rule on top of the arithmetic:{" "}
          <B>no dance is moved below half its cast to improve the rest of the
          week.</B>{" "}A dance can still be moved to a worse time — that&rsquo;s
          the whole point of trading — it just can&rsquo;t be gutted. Full
          attendance down to two-thirds is fine. Down to a third is not, at any
          price.
        </p>
        <p>
          <B>The one exception is getting a dance scheduled at all.</B>{" "}If the
          only workable time for a dance is one most of its cast can&rsquo;t
          make, it still takes it, because a thin rehearsal beats no rehearsal.
          The rule governs trading, not placing.
        </p>

        <h3 className="mt-2 font-semibold text-ink">
          Packing rooms — no stranded half-hours
        </h3>
        <p>
          The club has a fixed number of booked hours, and a 30-minute hole
          between two rehearsals in the same room is time nobody can use. So
          the builder counts up <B>the wasted minutes themselves</B> — every
          gap of <B>under 45 minutes</B> it would leave in a booked room — and
          drives that number down. A gap of 45 minutes or more isn&rsquo;t
          waste at all, because you can still book into it, so it costs
          nothing.
        </p>
        <p>
          It counts practices already in the room too, published ones and
          drafts alike, not just what it&rsquo;s placing this run.
        </p>
        <p>
          Counting minutes rather than just noticing a hole matters more than
          it sounds: a 5-minute sliver and a 40-minute hole used to score the
          same, and a slot with two awkward neighbours scored the same as one
          with a single awkward neighbour. Now they don&rsquo;t.
        </p>
        <p>
          <B>This is asked only after attendance.</B> Two weeks have to put
          exactly the same people in the room before room time is consulted at
          all, so a tidier set of bookings can never cost anybody their
          rehearsal — not for five wasted minutes and not for five hundred.
          Within that limit, though, the builder is ruthless about it: if a
          hole isn&rsquo;t costing anyone their attendance, it will go a long
          way to close it.
        </p>
        <p>
          The result line under Build the week says what you&rsquo;re left
          with — <B>no room time wasted</B>, or the number of minutes if the
          only way to keep everybody in the room left a hole behind.
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

      <Section title="The shared Google Calendar">
        <p>
          Separate from the one you read rooms off. This is the calendar the
          whole team subscribes to, with every published practice on it.
        </p>
        <h3 className="mt-2 font-semibold text-ink">Setting it up, once</h3>
        <p>
          <Nav href="/admin/settings">Settings</Nav> →{" "}
          <B>Shared team calendar</B>{" "}→ <B>Link the team calendar</B>, then
          pick it from the list. Make it a calendar owned by the{" "}
          <em>club account</em>{" "}and shared with you, not your personal one —
          that way it outlives you handing the role over.
        </p>
        <p>
          <B>Until you link one, nothing reaches Google.</B>{" "}The app still
          works and people still get told in the app — but the shared calendar
          stays empty, and until now it did that without saying so.
        </p>

        <h3 className="mt-2 font-semibold text-ink">How practices get there</h3>
        <p>
          <B>Publishing puts them there automatically.</B>{" "}You don&rsquo;t
          have to do anything. Move a published practice and the calendar
          follows immediately — the calendar is a reference, so it updates even
          though the <em>announcement</em>{" "}waits for you.
        </p>
        <p>
          <B>Drafts never go on it</B>, by design. Forty people read that
          calendar, and a draft is a time you haven&rsquo;t committed to.
        </p>

        <p>
          Every practice on it carries the roster in its notes — who&rsquo;s
          excused, who isn&rsquo;t, who&rsquo;s arriving late, and any notes
          you wrote ahead of time. The same body goes into people&rsquo;s own
          calendars when they add practices there, so nobody has to open the
          app to see who will be in the room.
        </p>

        <h3 className="mt-2 font-semibold text-ink">
          Checking it actually worked
        </h3>
        <p>
          On the Schedule Builder, under Build the week, there&rsquo;s{" "}
          <B>Send Sep 14 – Sep 20 to Google Calendar</B>. It pushes that
          week&rsquo;s published practices again and tells you the number that
          landed — &ldquo;6 of 6 practices sent to PADT Practices&rdquo;.
        </p>
        <p>
          Press it whenever you want to be sure, after a week where something
          looked off, or the first time you link the calendar. It&rsquo;s safe
          to press twice: each practice remembers its own event, so a second
          send updates the same entries rather than doubling them up.
        </p>
        <p>
          If it says practices <B>couldn&rsquo;t be written</B>, your Google
          sign-in has usually expired or the calendar stopped being shared with
          you. Sign out, sign back in, tick the calendar boxes, and send again.
        </p>
      </Section>

      <Section title="What the app sends, and when">
        <p>
          <B>Push notifications only — there is no email.</B>{" "}Forty students
          don&rsquo;t read club email, so it was taken out. That makes
          it worth telling people to add the app to their home screen:
          without that, Apple won&rsquo;t deliver push and they only see
          things when they open the app.
        </p>
        <table className="my-1 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th className="py-1 pr-3 font-medium text-ink">Message</th>
              <th className="py-1 pr-3 font-medium text-ink">Who gets it</th>
              <th className="py-1 font-medium text-ink">What sets it off</th>
            </tr>
          </thead>
          <tbody className="[&_td]:py-1 [&_td]:pr-3 [&_td]:align-top [&_tr]:border-b [&_tr]:border-line/60">
            <tr>
              <td>Schedule published</td>
              <td>Everyone in a practice you published</td>
              <td>
                <B>You press Publish.</B> Nothing before that.
              </td>
            </tr>
            <tr>
              <td>Something changed</td>
              <td>Only the people affected</td>
              <td>
                You publish an edit. Moving a practice five times still sends
                one message.
              </td>
            </tr>
            <tr>
              <td>Practice cancelled</td>
              <td>That dance&rsquo;s cast</td>
              <td>You delete a published practice</td>
            </tr>
            <tr>
              <td>A week is off</td>
              <td>That dance&rsquo;s cast</td>
              <td>You press announce. Marking the week off does nothing.</td>
            </tr>
            <tr>
              <td>
                <B>Starts in 15 minutes</B>
              </td>
              <td>The cast, minus anyone known to be missing</td>
              <td>Automatic, 15 minutes before the start</td>
            </tr>
            <tr>
              <td>Check in</td>
              <td>The cast, minus anyone known to be missing</td>
              <td>Automatic, as the practice starts</td>
            </tr>
            <tr>
              <td>Confirm attendance</td>
              <td>
                <B>Choreographers only</B>
              </td>
              <td>Automatic, as the practice ends</td>
            </tr>
            <tr>
              <td>Conflicts are due</td>
              <td>Only people who haven&rsquo;t submitted</td>
              <td>You press Nudge — or on the weekly schedule you set</td>
            </tr>
          </tbody>
        </table>
        <p>
          <B>Drafts never notify anybody.</B>{" "}Build a week, move things
          around, delete and rebuild it — the team sees none of it until you
          publish.
        </p>

        <h3 className="mt-2 font-semibold text-ink">
          The conflicts deadline
        </h3>
        <p>
          You set <B>one</B>{" "}time in{" "}
          <Nav href="/admin/settings">Settings</Nav>: when conflicts are due.
          It is currently <B>Thursday at noon</B>. Two messages hang off it,
          and both go only to the people who haven&rsquo;t submitted for the
          week starting the following Monday:
        </p>
        <ul>
          <li>
            <B>Two hours before</B>{" "}(10am) &mdash; &ldquo;Heads up: your
            conflicts are due in 2 hours&rdquo;. Early enough to actually do
            something about.
          </li>
          <li>
            <B>At the deadline</B>{" "}(noon) &mdash; &ldquo;Conflicts are due
            now. Open the app, press Sync, then press Submit.&rdquo;
          </li>
        </ul>
        <p>
          <B>Move the deadline and both move with it.</B>{" "}The heads-up is
          always two hours before whatever you set, so there is no second time
          to keep in step and nothing to leave stale.
        </p>
        <p>
          <B>These are the only messages the app sends without you pressing
          anything</B>, so they are worth knowing about. They were off by
          default and are now on. To stop them, untick the reminder in
          Settings.
        </p>
        <p>
          People who have already submitted are left alone, and if everyone
          has, nothing sends at all. Each goes once a week whatever happens, so
          you can&rsquo;t accidentally double up.
        </p>
        <h3 className="mt-2 font-semibold text-ink">
          Skipping a week, such as a break
        </h3>
        <p>
          Under the schedule in <Nav href="/admin/settings">Settings</Nav>{" "}
          there&rsquo;s <B>Weeks to skip</B>. Pick any date in a week and both
          reminders stay quiet for it. Every other week carries on as normal.
        </p>
        <p>
          This exists so you don&rsquo;t switch the whole thing off for winter
          break and then forget to switch it back on in January, which is the
          version of this that goes wrong.
        </p>
        <p>
          <B>The date means the week people would be submitting conflicts
          for</B>, not the week the reminder would be sent in. So to silence
          the reminders about the week of December 22, skip December 22 —
          they&rsquo;d otherwise have gone out on the Thursday before.
        </p>
        <p>
          Weeks in the past drop off the list on their own. To put one back,
          press <B>Remind after all</B>.
        </p>

        <p>
          <B>The wording names both presses on purpose.</B>{" "}It used to say
          &ldquo;add your conflicts&rdquo;, which let people think putting a
          class in Google Calendar was the whole job. The app never sees it
          until they press Sync, and you can&rsquo;t tell a clear week from an
          unchecked one until they press Submit.
        </p>
      </Section>

      <Section title="Late charges">
        <p>
          Late charges come out of the check-in records on their own. The only
          things anybody types are who has paid and what people earned back.
        </p>
        <p>
          <B>The ladder it starts with:</B>{" "}under 5 minutes free, 5 to 9 is
          $1, 10 to 14 is $2, 15 to 29 is $5, 30 or more is $10. Not turning up
          costs nothing here, and somebody with an agreed late arrival is
          measured from the time they agreed, so keeping to it is free. You can
          change all of these — see <B>Rates &amp; credits</B> below.
        </p>
        <p>
          <B>Credits:</B>{" "}the app ships with leading Pan-Asian time or a
          workshop at $1 off and attending one at 50c, and you can add your own.
          They come off the oldest charges first and roll forward within a
          semester. Nothing carries into the next one.
        </p>
        <p>Four tabs, because they are four different jobs:</p>
        <ul>
          <li>
            <B>Monthly ledger</B>{" "}— chasing one month. Two tables: every
            late arrival on its own line with the dance, the time and when they
            walked in, then what each person owes with the ticks for Venmo
            requested and Paid.
          </li>
          <li>
            <B>Semester summary</B>{" "}— every dancer, their charges month by
            month, what was collected and what is still out. Sorted with the
            biggest outstanding amount at the top, so the people to chase are
            the people you see first. The spreadsheet export is here.
          </li>
          <li>
            <B>Credits &amp; workshops</B>{" "}— plus and minus buttons for
            logging during a meeting.
          </li>
          <li>
            <B>Rates &amp; credits</B>{" "}— what being late costs and what
            earns money back. Yours alone; the treasurer doesn&rsquo;t see this
            tab.
          </li>
        </ul>
        <p>
          <B>Fixing a charge you disagree with.</B>{" "}On the Monthly ledger
          there is a <B>Fix</B>{" "}button at the end of every line. It does
          three things:
        </p>
        <ul>
          <li>
            <B>Change the minutes.</B>{" "}For when the sheet says twelve
            minutes because the rehearsal didn&rsquo;t start on time. The charge
            re-prices itself at whatever the rates were that day. Take it under
            the free threshold and the line disappears, because there is no
            charge left to show — the record is still on the practice&rsquo;s
            attendance sheet.
          </li>
          <li>
            <B>Waive it.</B>{" "}Type a reason and the charge goes to zero. The
            reason shows on that person&rsquo;s own page, so you are not the
            only one who remembers why. You can put it back later.
          </li>
          <li>
            <B>Open the attendance sheet</B>{" "}for that practice, to change
            who was there or when it really started. Changing the real start
            time recalculates everybody at that practice at once, which is
            usually the right fix when a rehearsal ran late.
          </li>
        </ul>
        <p>
          <B>Only you can do any of that.</B>{" "}A treasurer sees the same
          charges and ticks the same boxes, but cannot change minutes, waive
          anything, or touch the rates.
        </p>
        <p>
          <B>Changing what being late costs.</B>{" "}On{" "}
          <B>Rates &amp; credits</B>, each set of rates starts on a date. Press{" "}
          <B>New rates from a date</B>, set the date and the steps, and save.
          Charges are priced by whichever set was running on the day of the
          rehearsal, so raising the rates in October leaves September exactly as
          people were told it. Editing a set that is already in use does
          re-price everything under it, so add a new dated set rather than
          editing the old one unless you are fixing a typo.
        </p>
        <p>
          <B>Changing what earns money back.</B>{" "}Same tab, second list. Add a
          category, give it a name and an amount, and it appears as a column on{" "}
          <B>Credits &amp; workshops</B>{" "}straight away. Changing an amount
          only affects credits logged from then on — each one keeps what it was
          worth on the day it was earned. Removing a category that people have
          already earned keeps it on their ledger and just takes it off the
          list.
        </p>
        <p>
          <B>No total is stored anywhere.</B>{" "}Everything is worked out from
          the attendance records each time you open the page, so editing a
          practice updates the money with it and nothing can drift out of step.
          The one exception is a month you have marked paid, which remembers
          what it cost at that moment so a later edit can&rsquo;t move a
          receipt.
        </p>
        <p>
          <B>Charges start from August 2026.</B>{" "}Nothing recorded before
          then is ever billed, so switching this on didn&rsquo;t hand anybody a
          surprise bill for old rehearsals.
        </p>
        <p>
          <B>What the team sees.</B>{" "}Each dancer gets their own charges on{" "}
          <Nav href="/my-attendance">My Attendance</Nav>, under a{" "}
          <B>Late charges</B>{" "}tab, with their practice record on a second
          tab beside it. They see their own and nobody else&rsquo;s. Expect to
          be asked about waivers, because the reason you type is the reason they
          read.
        </p>
        <p>
          <B>Letting somebody else run it.</B>{" "}On{" "}
          <Nav href="/admin/roster">Roster</Nav> there&rsquo;s a{" "}
          <B>Give late charges</B>{" "}button next to each person. It opens this
          one page for them and nothing else: no casting, no room bookings, no
          schedule builder, no conflict notes. They keep their normal dancer
          navigation with one extra link added.
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
