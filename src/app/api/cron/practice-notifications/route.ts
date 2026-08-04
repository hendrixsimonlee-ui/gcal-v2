import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyAttendanceDue, notifyCheckInOpen } from "@/lib/notify";
import { settleAttendance } from "@/lib/actions/attendance";

/** How far back to look for practices that have just started or just ended.
 * Comfortably wider than the every-5-minutes schedule, because the two
 * notification types are de-duplicated by their own notification rows rather
 * than by timing. */
const LOOKBACK_MINUTES = 15;

/** Fires the two time-based notifications: "practice started, check in" for
 * the cast, and "confirm attendance" for the choreographers when it ends.
 *
 * A web app can't wake itself up, so this is driven by a scheduled request
 * (see vercel.json). It's safe to call as often as you like — each
 * notification type is only sent once per practice, checked against the
 * notification rows themselves. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_MINUTES * 60_000);

  const [justStarted, justEnded] = await Promise.all([
    prisma.practice.findMany({
      where: {
        status: "CONFIRMED",
        startDateTime: { gte: since, lte: now },
        dance: { archivedAt: null },
      },
      select: { id: true, danceId: true },
    }),
    prisma.practice.findMany({
      where: {
        status: "CONFIRMED",
        endDateTime: { gte: since, lte: now },
        dance: { archivedAt: null },
      },
      select: { id: true, danceId: true },
    }),
  ]);

  let checkInSent = 0;
  for (const practice of justStarted) {
    if (await alreadySent(practice.id, "CHECK_IN_OPEN")) continue;
    await notifyCheckInOpen(practice.id);
    checkInSent++;
  }

  let attendanceSent = 0;
  for (const practice of justEnded) {
    if (await alreadySent(practice.id, "ATTENDANCE_DUE")) continue;
    // Fill in everyone who never checked in first, so the recap the
    // choreographer opens is already complete rather than half-empty.
    await settleAttendance(practice.id);
    await notifyAttendanceDue(practice.id);
    attendanceSent++;
  }

  return NextResponse.json({
    checkInSent,
    attendanceSent,
    checkedAt: now.toISOString(),
  });
}

/** De-duplication without a "notified" column: the notification rows carry
 * the practice's link, so their existence is the record that it went out. */
async function alreadySent(
  practiceId: string,
  type: "CHECK_IN_OPEN" | "ATTENDANCE_DUE",
): Promise<boolean> {
  const href =
    type === "ATTENDANCE_DUE" ? `/attendance/${practiceId}` : "/schedule";

  if (type === "CHECK_IN_OPEN") {
    // "/schedule" isn't unique to one practice, so match on the message,
    // which names the dance and can only have been written for this one.
    const practice = await prisma.practice.findUnique({
      where: { id: practiceId },
      select: { dance: { select: { name: true } }, startDateTime: true },
    });
    if (!practice) return true;
    const existing = await prisma.notification.findFirst({
      where: {
        type,
        message: { startsWith: `${practice.dance.name} has started` },
        createdAt: { gte: practice.startDateTime },
      },
      select: { id: true },
    });
    return existing !== null;
  }

  const existing = await prisma.notification.findFirst({
    where: { type, href },
    select: { id: true },
  });
  return existing !== null;
}
