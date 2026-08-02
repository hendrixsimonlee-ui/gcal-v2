import { prisma } from "@/lib/prisma";
import { googleCalendarAddUrl } from "@/lib/calendar-links";
import type { NotificationType } from "@/generated/prisma/enums";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
