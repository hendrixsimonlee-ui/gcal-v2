import { prisma } from "@/lib/prisma";
import { googleCalendarAddUrl } from "@/lib/calendar-links";
import { sendPushToUsers } from "@/lib/push";
import { isExpectedToCheckIn } from "@/lib/attendance";
import type { NotificationType } from "@/generated/prisma/enums";
import { APP_TIME_ZONE } from "@/lib/timezone";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Sends an email if Resend is configured. Deliberately best-effort: a
 * missing API key (or a bounced send) must never break the AD's action of
 * confirming a practice, so failures are logged and swallowed. */
async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { skipped: true as const };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      console.error("Email send failed", res.status, await res.text());
      return { skipped: false as const, ok: false as const };
    }
    return { skipped: false as const, ok: true as const };
  } catch (error) {
    console.error("Email send threw", error);
    return { skipped: false as const, ok: false as const };
  }
}

/** Tells a dance's cast that a practice is locked in: an in-app notification
 * for everyone, plus an email with an add-to-calendar link. */
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
  const message = `${practice.dance.name} practice confirmed — ${when} at ${where}`;

  const recipients = practice.dance.memberships.map((m) => m.user);
  if (recipients.length === 0) return;

  await prisma.notification.createMany({
    data: recipients.map((user) => ({
      userId: user.id,
      type: "SCHEDULE_FINALIZED" as NotificationType,
      message,
    })),
  });

  const addUrl = googleCalendarAddUrl({
    title: `${practice.dance.name} practice`,
    start: practice.startDateTime,
    end: practice.endDateTime,
    location: practice.space?.location ?? practice.space?.name ?? undefined,
    details: `${practice.dance.name} rehearsal.`,
  });

  const html = `
    <p>Your <strong>${escapeHtml(practice.dance.name)}</strong> practice is confirmed.</p>
    <p><strong>${escapeHtml(when)}</strong><br/>${escapeHtml(where)}</p>
    <p><a href="${addUrl}">Add it to your Google Calendar</a></p>
  `;

  await Promise.all(
    recipients.map((user) =>
      sendEmail(user.email, `${practice.dance.name} practice confirmed`, html),
    ),
  );
}

/** Announces a batch of newly confirmed practices — the "publish the whole
 * term at once" flow. Deliberately one notification and one email per
 * person listing all of their practices, rather than one per practice,
 * which would mean a dozen emails landing at once. */
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
  const perUser = new Map<
    string,
    { email: string; name: string | null; items: typeof practices }
  >();

  for (const practice of practices) {
    for (const membership of practice.dance.memberships) {
      const existing = perUser.get(membership.userId);
      if (existing) {
        existing.items.push(practice);
      } else {
        perUser.set(membership.userId, {
          email: membership.user.email,
          name: membership.user.name,
          items: [practice],
        });
      }
    }
  }

  const notifications: { userId: string; type: NotificationType; message: string }[] = [];
  const emails: { to: string; subject: string; html: string }[] = [];

  for (const [userId, { email, items }] of perUser) {
    const count = items.length;
    notifications.push({
      userId,
      type: "SCHEDULE_FINALIZED",
      message:
        count === 1
          ? `Schedule published — ${items[0].dance.name} on ${dateFormatter.format(items[0].startDateTime)}`
          : `Schedule published — ${count} practices confirmed for you`,
    });

    const rows = items
      .map((practice) => {
        const addUrl = googleCalendarAddUrl({
          title: `${practice.dance.name} practice`,
          start: practice.startDateTime,
          end: practice.endDateTime,
          location: practice.space?.location ?? practice.space?.name ?? undefined,
          details: `${practice.dance.name} rehearsal.`,
        });
        return `<li><strong>${escapeHtml(practice.dance.name)}</strong> — ${escapeHtml(
          dateFormatter.format(practice.startDateTime),
        )}, ${escapeHtml(practice.space?.name ?? "space TBD")} · <a href="${addUrl}">add to calendar</a></li>`;
      })
      .join("");

    emails.push({
      to: email,
      subject:
        count === 1
          ? "Your practice is confirmed"
          : `Your schedule is set — ${count} practices`,
      html: `<p>The schedule has been published. Here's yours:</p><ul>${rows}</ul>`,
    });
  }

  await prisma.notification.createMany({ data: notifications });
  await Promise.all(emails.map((e) => sendEmail(e.to, e.subject, e.html)));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** One person, one message, through every channel that's available: in-app
 * always, push if they've installed the app, email if Resend is configured. */
async function notify(
  recipients: { id: string; email: string }[],
  type: NotificationType,
  message: string,
  opts: { href?: string; emailSubject?: string; emailHtml?: string } = {},
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
    { title: "PADT", body: message, href: opts.href },
  );

  if (opts.emailSubject && opts.emailHtml) {
    await Promise.all(
      recipients.map((user) =>
        sendEmail(user.email, opts.emailSubject!, opts.emailHtml!),
      ),
    );
  }
}

/** "Practice is starting — check in." Sent as the practice begins, to the
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
  const [conflicts, unavailabilities] = await Promise.all([
    prisma.conflict.findMany({ where: { userId: { in: castIds } } }),
    prisma.unavailability.findMany({ where: { userId: { in: castIds } } }),
  ]);
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
          unavailabilities,
        ),
    )
    .map((m) => m.user);

  await notify(
    recipients,
    "CHECK_IN_OPEN",
    `${practice.dance.name} has started at ${practice.space?.name ?? "your space"} — check in`,
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
    `Confirm attendance for ${practice.dance.name} — ${when}`,
    {
      href: `/attendance/${practiceId}`,
      emailSubject: `Confirm attendance for ${practice.dance.name}`,
      emailHtml: `<p>Your <strong>${escapeHtml(practice.dance.name)}</strong> practice on ${escapeHtml(when)} has finished.</p><p>Open the app to check the recap and submit it.</p>`,
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
      : `${practice.dance.name} moved — now ${when} at ${where}`;

  await notify(
    practice.dance.memberships.map((m) => m.user),
    "PRACTICE_CHANGED",
    message,
    {
      href: "/schedule",
      emailSubject: `${practice.dance.name} practice ${change}`,
      emailHtml: `<p>${escapeHtml(message)}.</p>`,
    },
  );
}
