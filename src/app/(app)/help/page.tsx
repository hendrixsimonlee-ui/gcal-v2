import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/** The page you point 40 people at instead of answering the same question
 * forty times. Everyone sees the dancer section; the choreographer and AD
 * sections appear only for the people they apply to. */
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
          The short version: tell us when you&rsquo;re busy, we build the
          schedule around it, you tap Check in at practice.
        </p>
      </div>

      <Section title="First, put it on your home screen">
        <p>
          On an iPhone: tap <B>Share</B>, then <B>Add to Home Screen</B>. On
          Android, Chrome offers <B>Install app</B>.
        </p>
        <p>
          This isn&rsquo;t just tidiness — a website can only send you a
          notification once it&rsquo;s on your home screen. That&rsquo;s
          Apple&rsquo;s rule, not ours. Without it you&rsquo;ll never get the
          nudge when practice starts.
        </p>
      </Section>

      <Section title="Telling us when you're busy">
        <p>
          You were given a <B>PADT conflict calendar</B> at the start of the
          year. Put your classes, work shifts and commitments on it, then open{" "}
          <Link href="/conflicts" className="underline">
            My Conflicts
          </Link>
          , tap <B>Choose my calendar</B> once, and hit{" "}
          <B>Sync the whole term</B>. Keep that calendar current and the app
          follows it — you never type a conflict twice.
        </p>
        <p>
          You can also add one directly by dragging on the calendar. Just say
          what it is and when. You don&rsquo;t categorise anything; the AD
          decides what counts as excused.
        </p>
        <p>
          Gone for a stretch — a trip, a term abroad? Use{" "}
          <B>Out of town</B> at the bottom of that page instead. It takes you
          out of scheduling entirely for those dates.
        </p>
      </Section>

      <Section title="Checking in at practice">
        <p>
          When practice starts, a <B>Check in</B> button appears at the top of{" "}
          <Link href="/schedule" className="underline">
            My Schedule
          </Link>{" "}
          and your phone buzzes. Tap it.
        </p>
        <ul>
          <li>
            It opens exactly when practice starts and closes when it&rsquo;s
            due to end.
          </li>
          <li>
            <B>Under 5 minutes counts as on time.</B> Past that it records how
            many minutes late you were.
          </li>
          <li>
            If you already logged a conflict for that time, you don&rsquo;t
            need to check in at all — we know.
          </li>
          <li>
            If you never check in and had nothing logged, it goes down as an
            unexcused absence. Your choreographer or the AD can fix that if
            your phone died.
          </li>
          <li>
            Choreographers check in too, for their own dances.
          </li>
        </ul>
        <p>
          Know in advance you&rsquo;ll be late every week — a class that runs
          to 6:15? Tell the AD and they&rsquo;ll set your arrival time.
          Turning up by then counts as on time.
        </p>
      </Section>

      <Section title="Your own record">
        <p>
          <Link href="/my-attendance" className="underline">
            My Attendance
          </Link>{" "}
          has every practice you&rsquo;ve had and what was recorded. Tap any
          one to see the full record for that practice — who was there, who
          checked in when. If you ever think something&rsquo;s wrong,
          that&rsquo;s the page to open, and everyone else can see the same
          thing.
        </p>
      </Section>

      {choreographs && (
        <Section title="If you choreograph a dance">
          <p>
            <Link href="/attendance" className="underline">
              Attendance
            </Link>{" "}
            is your screen. Before a practice, open it from <B>Coming up</B>{" "}
            to see who&rsquo;s expected, who&rsquo;s excused and who&rsquo;s
            arriving late.
          </p>
          <p>
            You don&rsquo;t tick anyone off — everyone checks themselves in.
            When practice ends you get a notification, you look over the recap,
            fix anything wrong, and hit <B>Submit</B>. There&rsquo;s no
            deadline; come back days later if that&rsquo;s when you get to it.
          </p>
          <ul>
            <li>
              If practice started late, record the real start time. Everyone&rsquo;s
              lateness recalculates from there, so nobody is penalised for a
              practice that hadn&rsquo;t begun.
            </li>
            <li>
              Write notes on the practice, or about one person — what got
              missed, why someone was late.
            </li>
          </ul>
        </Section>
      )}

      {user.isAdmin && (
        <Section title="If you run the schedule">
          <p>
            Your week lives in{" "}
            <Link href="/admin" className="underline">
              Admin Console → This week
            </Link>
            , which walks the order it has to happen in:
          </p>
          <ol>
            <li>
              <B>Review conflicts</B> — everything logged, person by person.
              Mark each excused or unexcused. Nothing is decided until you do.
            </li>
            <li>
              <B>Sort the spaces</B> — sync the room calendars, note anything
              different this week.
            </li>
            <li>
              <B>Build the schedule</B> — pick from ranked suggestions or drag
              a slot out yourself. The tracker tells you which dances are still
              outstanding.
            </li>
            <li>
              <B>Publish</B> — everyone is notified at once and the team
              calendar fills in. Move something afterwards and the calendar
              follows automatically.
            </li>
            <li>
              <B>Check attendance</B> — chronic absence, minutes late, and any
              record you need to correct.
            </li>
          </ol>
          <p>
            Any name on the roster or in Attendance Review opens that
            person&rsquo;s full record — every practice, every conflict, every
            note — with the override in reach on each row.
          </p>
        </Section>
      )}

      <p className="text-sm text-ink-soft">
        Something not behaving? Tell the AD — they can correct any record.
      </p>
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

function B({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-semibold text-ink">
      {children}
    </strong>
  );
}
