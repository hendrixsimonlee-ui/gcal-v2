import { prisma } from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";
import { isExpectedToCheckIn } from "@/lib/attendance";
import type { NotificationType } from "@/generated/prisma/enums";
import { APP_TIME_ZONE } from "@/lib/timezone";

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Tells a dance's cast that a practice is locked in: an in-app notification
/** Tells a dance's cast that a practice is locked in: an in-app notification
 * and a push, for everyone in the dance. */
export async function notifyPracticeConfirmed(practiceId: string) {
  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    include: {
      dance: { include: { memberships: { include: { user: true } } } },
      space: true,
    },
  });
  if (!practice) return;

  const when = dateFormatter.format(practice.startDateTime);
  const where = practice.space?.name ?? "Space TBD";

  await notify(
    practice.dance.memberships.map((m) => m.user),
    "SCHEDULE_FINALIZED",
    `${practice.dance.name} practice is set for ${when} at ${where}`,
    { href: "/schedule" },
  );
}

/** Announces a batch of newly confirmed practices — the "publish the week"
 * flow. One notification and one push per person, listing how many practices
 * they got, rather than one per practice: a dancer in four dances should feel
 * one buzz, not four.
 *
 * Only ever called from publishing. A draft has never reached anybody and
 * never will — this is the moment the schedule becomes real. */
export async function notifySchedulePublished(practiceIds: string[]) {
  if (practiceIds.length === 0) return;

  const practices = await prisma.practice.findMany({
    where: { id: { in: practiceIds } },
    include: {
      dance: { include: { memberships: { include: { user: true } } } },
      space: true,
    },
    orderBy: { startDateTime: "asc" },
  });
  if (practices.length === 0) return;

  // userId -> the practices that person is actually in
  const perUser = new Map<string, typeof practices>();
  for (const practice of practices) {
    for (const membership of practice.dance.memberships) {
      const existing = perUser.get(membership.userId);
      if (existing) existing.push(practice);
      else perUser.set(membership.userId, [practice]);
    }
  }

  const notifications: {
    userId: string;
    type: NotificationType;
    message: string;
    href: string;
  }[] = [];

  for (const [userId, items] of perUser) {
    notifications.push({
      userId,
      type: "SCHEDULE_FINALIZED",
      message:
        items.length === 1
          ? `Your schedule is up. ${items[0].dance.name} on ${dateFormatter.format(items[0].startDateTime)}`
          : `Your schedule is up. You have ${items.length} practices this week`,
      href: "/schedule",
    });
  }

  await prisma.notification.createMany({ data: notifications });

  // The message differs per person, so the in-app rows are written in one go
  // above and the push is sent once for everyone with wording that doesn't
  // need to know whose phone it lands on. A lock screen shouldn't carry the
  // whole schedule anyway.
  await sendPushToUsers(Array.from(perUser.keys()), {
    title: "PADT",
    body: "Your schedule is up. Open the app to see your practices",
    href: "/schedule",
  });
}

/** Announces edits made to practices that were already published.
 *
 * Moving a published practice used to message the whole cast the moment the
 * AD let go of the mouse — so nudging three practices around on a Sunday
 * evening meant three rounds of pings, and people stopped reading them. Now
 * an edit is staged, and this sends one message per person covering
 * everything that changed for them, whatever it was and however many times
 * the AD moved it.
 *
 * Returns how many people were written to, so the button can say so. */
export async function announcePracticeChanges(
  practiceIds: string[],
): Promise<number> {
  if (practiceIds.length === 0) return 0;

  const practices = await prisma.practice.findMany({
    where: { id: { in: practiceIds } },
    include: {
      dance: { include: { memberships: { include: { user: true } } } },
      space: true,
    },
    orderBy: { startDateTime: "asc" },
  });
  if (practices.length === 0) return 0;

  const perUser = new Map<
    string,
    { user: { id: string; email: string }; lines: string[] }
  >();

  for (const practice of practices) {
    const when = dateFormatter.format(practice.startDateTime);
    const where = practice.space?.name ?? "space TBD";
    const line = `${practice.dance.name} is now ${when} at ${where}${ practice.pendingChangeNote ? ` (${practice.pendingChangeNote})` : ""
    }`;

    for (const membership of practice.dance.memberships) {
      const entry = perUser.get(membership.userId);
      if (entry) entry.lines.push(line);
      else
        perUser.set(membership.userId, {
          user: { id: membership.userId, email: membership.user.email },
          lines: [line],
        });
    }
  }

  const notifications: {
    userId: string;
    type: NotificationType;
    message: string;
    href: string;
  }[] = [];

  for (const [userId, { lines }] of perUser) {
    const message =
      lines.length === 1
        ? lines[0]
        : `${lines.length} of your practices changed`;
    notifications.push({
      userId,
      type: "PRACTICE_CHANGED",
      message,
      href: "/schedule",
    });
  }

  await prisma.notification.createMany({ data: notifications });
  await sendPushToUsers(
    Array.from(perUser.keys()),
    {
      title: "PADT",
      body: "Something on your schedule changed. Open the app to see what",
      href: "/schedule",
    },
  );

  return perUser.size;
}

/** "Your conflicts for next week aren't in yet." The AD's nudge, sent only to
 * the people who haven't submitted — never to the whole roster. */
export async function notifyConflictsDue(
  userIds: string[],
  weekLabel: string,
): Promise<number> {
  if (userIds.length === 0) return 0;
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true },
  });

  await notify(
    users,
    "CONFLICTS_DUE",
    `Please add your conflicts for the week of ${weekLabel}`,
    {
      href: "/conflicts",
    },
  );
  return users.length;
}

/** "Bhangra isn't practising the week of Aug 3." Sent only when the AD asks
 * for it, never as a side effect of marking the week off. */
export async function notifyWeekCancelled(
  danceId: string,
  weekOf: Date,
): Promise<number> {
  const dance = await prisma.dance.findUnique({
    where: { id: danceId },
    include: { memberships: { include: { user: true } } },
  });
  if (!dance || dance.memberships.length === 0) return 0;

  const label = weekLabelFormatter.format(weekOf);
  const message = `${dance.name} isn't practising the week of ${label}`;

  await notify(
    dance.memberships.map((m) => m.user),
    "PRACTICE_CHANGED",
    message,
    {
      href: "/schedule",
    },
  );
  return dance.memberships.length;
}

const weekLabelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "long",
  day: "numeric",
});


/** One person, one message, through both channels the app has: an in-app
 * notification always, and a push if they've turned them on.
 *
 * Email is gone on purpose. Forty students do not read club email, it needed
 * a Resend key nobody had set, and a send that silently skipped looked
 * identical to one that worked. Push is the channel people actually see, so
 * it is the only one worth having. */
async function notify(
  recipients: { id: string; email: string }[],
  type: NotificationType,
  message: string,
  opts: { href?: string; pushBody?: string } = {},
) {
  if (recipients.length === 0) return;

  await prisma.notification.createMany({
    data: recipients.map((user) => ({
      userId: user.id,
      type,
      message,
      href: opts.href ?? null,
    })),
  });

  await sendPushToUsers(
    recipients.map((r) => r.id),
    { title: "PADT", body: opts.pushBody ?? message, href: opts.href },
  );
}

/** "Bhangra starts in 15 minutes. Studio A, 3:00 PM."
 *
 * The one notification that arrives while there is still time to do something
 * about it. Check-in fires as the practice begins, which is useful for
 * marking attendance and useless for getting anybody there; this is the one
 * that actually gets people in the room, so it leads with the place.
 *
 * Same recipient rule as check-in: nobody is buzzed about a practice the app
 * already knows they can't make. Somebody with a logged conflict or marked
 * conflict is left alone; somebody who said they'd arrive late still gets it,
 * because they are coming. */
export async function notifyPracticeStartingSoon(practiceId: string) {
  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    include: {
      dance: { include: { memberships: { include: { user: true } } } },
      space: true,
      plannedArrivals: { select: { userId: true } },
    },
  });
  if (!practice) return;

  const castIds = practice.dance.memberships.map((m) => m.userId);
  const conflicts = await prisma.conflict.findMany({
    where: { userId: { in: castIds } },
  });
  const planned = new Set(practice.plannedArrivals.map((p) => p.userId));

  const recipients = practice.dance.memberships
    .filter(
      (m) =>
        planned.has(m.userId) ||
        isExpectedToCheckIn(
          m.userId,
          practice.startDateTime,
          practice.endDateTime,
          conflicts,
        ),
    )
    .map((m) => m.user);

  const where = practice.space?.name ?? "the usual space";
  const at = timeFormatter.format(practice.startDateTime);

  await notify(
    recipients,
    "REMINDER",
    `${practice.dance.name} starts in 15 minutes. ${where}, ${at}`,
    { href: "/schedule" },
  );
}

/** "Bhangra has started at Studio A. Tap to check in." Sent as the
 * practice begins, to the
 * people who are actually expected there. */
export async function notifyCheckInOpen(practiceId: string) {
  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    include: {
      dance: { include: { memberships: { include: { user: true } } } },
      space: true,
      plannedArrivals: { select: { userId: true } },
    },
  });
  if (!practice) return;

  const castIds = practice.dance.memberships.map((m) => m.userId);
  const conflicts = await prisma.conflict.findMany({
    where: { userId: { in: castIds } },
  });
  const planned = new Set(practice.plannedArrivals.map((p) => p.userId));

  // Nobody gets nagged about a practice the app already knows they're
  // missing. An agreed late arrival still gets it — they are coming.
  const recipients = practice.dance.memberships
    .filter(
      (m) =>
        planned.has(m.userId) ||
        isExpectedToCheckIn(
          m.userId,
          practice.startDateTime,
          practice.endDateTime,
          conflicts,
        ),
    )
    .map((m) => m.user);

  await notify(
    recipients,
    "CHECK_IN_OPEN",
    `${practice.dance.name} has started at ${practice.space?.name ?? "your space"}. Tap to check in`,
    { href: "/schedule" },
  );
}

/** "Confirm attendance." Sent to a dance's choreographers when the practice
 * is slated to end. There's no deadline attached — this is a nudge, not a
 * cut-off. */
export async function notifyAttendanceDue(practiceId: string) {
  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    include: {
      dance: {
        include: {
          memberships: {
            where: { role: "CHOREOGRAPHER" },
            include: { user: true },
          },
        },
      },
    },
  });
  if (!practice) return;

  const when = dateFormatter.format(practice.startDateTime);
  await notify(
    practice.dance.memberships.map((m) => m.user),
    "ATTENDANCE_DUE",
    `Tick off who came to ${practice.dance.name} on ${when}`,
    {
      href: `/attendance/${practiceId}`,
    },
  );
}

/** A published practice moved or was cancelled. Everyone in that dance hears
 * about it — the shared calendar updating silently isn't enough. */
export async function notifyPracticeChanged(
  practiceId: string,
  change: "moved" | "cancelled",
) {
  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    include: {
      dance: { include: { memberships: { include: { user: true } } } },
      space: true,
    },
  });
  if (!practice) return;

  const when = dateFormatter.format(practice.startDateTime);
  const where = practice.space?.name ?? "Space TBD";
  const message =
    change === "cancelled"
      ? `${practice.dance.name} on ${when} is cancelled`
      : `${practice.dance.name} moved. It is now ${when} at ${where}`;

  await notify(
    practice.dance.memberships.map((m) => m.user),
    "PRACTICE_CHANGED",
    message,
    {
      href: "/schedule",
    },
  );
}
