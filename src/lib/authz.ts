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
