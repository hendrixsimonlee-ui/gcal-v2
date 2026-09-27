"use server";

/** Choreographers saying a record is wrong, without being able to change it.
 *
 * They used to edit attendance directly. That is how somebody fourteen minutes
 * late became "here" and a charge vanished — one dropdown, no trace, and
 * nobody knew until the month didn't add up. They still know better than
 * anybody what happened in the room, so the knowledge has to keep reaching the
 * AD; only the writing stops.
 *
 * A flag is that knowledge with a name on it. It queues on Attendance Review
 * and the AD resolves it. */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUser } from "@/lib/authz";

export type FlagRow = {
  id: string;
  practiceId: string;
  danceName: string;
  startIso: string;
  subjectUserId: string;
  subjectName: string;
  raisedByName: string;
  body: string;
  isAutomatic: boolean;
  createdAtIso: string;
};

/** Raises a flag about one person at one practice.
 *
 * Open to anybody in the cast about themselves, and to the dance's
 * choreographers about anyone — the same rule as notes, because it is the same
 * kind of statement. The difference is that this one waits to be answered. */
export async function raiseAttendanceFlag(
  practiceId: string,
  subjectUserId: string,
  body: string,
): Promise<void> {
  const user = await requireUser();
  const text = body.trim();
  if (!text) throw new Error("Say what's wrong, or there's nothing to act on.");

  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    include: { dance: { include: { memberships: true } } },
  });

  const mine = practice.dance.memberships.find((m) => m.userId === user.id);
  const isChoreographer = mine?.role === "CHOREOGRAPHER" || user.isAdmin === true;
  if (!mine && !user.isAdmin) throw new Error("You're not part of this dance");
  if (subjectUserId !== user.id && !isChoreographer) {
    throw new Error("Only a choreographer or the AD can flag someone else");
  }

  await prisma.attendanceFlag.create({
    data: { practiceId, subjectUserId, raisedById: user.id, body: text },
  });

  revalidatePath(`/attendance/${practiceId}`);
  revalidatePath("/admin/attendance");
  revalidatePath("/admin");
}

/** Everything still waiting on the AD, oldest first — the order they should be
 * worked through, since the oldest is the one somebody has been waiting on. */
export async function getOpenFlags(): Promise<FlagRow[]> {
  await requireAdmin();
  const rows = await prisma.attendanceFlag.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      practiceId: true,
      body: true,
      isAutomatic: true,
      createdAt: true,
      subjectUserId: true,
      subject: { select: { name: true, email: true } },
      raisedBy: { select: { name: true, email: true } },
      practice: {
        select: { startDateTime: true, dance: { select: { name: true } } },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    practiceId: r.practiceId,
    danceName: r.practice.dance.name,
    startIso: r.practice.startDateTime.toISOString(),
    subjectUserId: r.subjectUserId,
    subjectName: r.subject.name ?? r.subject.email,
    raisedByName: r.raisedBy.name ?? r.raisedBy.email,
    body: r.body,
    isAutomatic: r.isAutomatic,
    createdAtIso: r.createdAt.toISOString(),
  }));
}

export async function countOpenFlags(): Promise<number> {
  await requireAdmin();
  return prisma.attendanceFlag.count({ where: { resolvedAt: null } });
}

/** Marks a flag dealt with.
 *
 * Resolved rather than deleted: the flag is the reason a record says what it
 * says, and six weeks later "why is this one marked present" is a question
 * somebody will ask. */
export async function resolveAttendanceFlag(flagId: string): Promise<void> {
  const actor = await requireAdmin();
  await prisma.attendanceFlag.update({
    where: { id: flagId },
    data: { resolvedAt: new Date(), resolvedById: actor.id },
  });
  revalidatePath("/admin/attendance");
  revalidatePath("/admin");
}
