import { auth } from "@/auth";

/** Defense in depth for server actions: the admin layout already redirects
 * non-admins away from /admin, but actions can be invoked directly. */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    throw new Error("Admin access required");
  }
  return session.user;
}
