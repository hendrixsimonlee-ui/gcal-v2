import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/** Defense in depth for server actions: the admin layout already redirects
 * non-admins away from /admin, but actions can be invoked directly. */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    throw new Error("Admin access required");
  }
  return session.user;
}

export async function requireUser() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Sign-in required");
  }
  return session.user;
}

/** Attendance check-off is done by the dance's own choreographers; the AD can
 * do it for any dance. */
export async function requireChoreographerOrAdmin(danceId: string) {
  const user = await requireUser();
  if (user.isAdmin) return user;

  const membership = await prisma.danceMembership.findFirst({
    where: { danceId, userId: user.id, role: "CHOREOGRAPHER" },
    select: { id: true },
  });
  if (!membership) {
    throw new Error("You don't choreograph this dance");
  }
  return user;
}

/** The dues ledger, and nothing else.
 *
 * The treasurer is an ordinary dancer who chases Venmo requests. Making them
 * an admin to let them do that would also hand them casting, room bookings,
 * the schedule builder and everybody's conflict notes, which is far more than
 * the job needs and more than most people would want to be responsible for.
 *
 * So this is the only door the flag opens. Every other admin action still
 * goes through `requireAdmin`, and the admin layout still turns them away at
 * the door. If a future page wants to be finance-accessible it has to say so
 * by calling this, rather than inheriting it by living under /admin. */
export async function requireFinance() {
  const user = await requireUser();
  if (!user.isAdmin && !user.isFinanceAdmin) {
    throw new Error("Dues ledger access required");
  }
  return user;
}
