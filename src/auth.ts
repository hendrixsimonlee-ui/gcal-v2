import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

// Calendar scopes are requested at sign-in so one login covers everything
// the app does with Google:
//
//   calendar.readonly — list someone's calendars (so they can point us at
//     their PADT conflict calendar) and read events off it.
//   calendar.events   — write practices onto the shared team calendar, and
//     update those events in place when the AD moves something.
//
// The write scope is only ever exercised with an admin's token against the
// team calendar. It's requested from everyone because Auth.js asks for one
// scope set at sign-in; the trade-off is that the consent screen mentions
// editing events for all users, not just admins.
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

/** Grants admin to whoever matches INITIAL_ADMIN_EMAIL. Runs on every sign-in
 * but only ever promotes — it never demotes, so removing the env var later
 * (or the AD handing off) doesn't strip anyone's access. */
export async function promoteIfInitialAdmin(
  userId: string | undefined,
  email: string | null | undefined,
) {
  const configured = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  if (!configured || !userId || !email) return;
  if (email.trim().toLowerCase() !== configured) return;

  await prisma.user.updateMany({
    where: { id: userId, isAdmin: false },
    data: { isAdmin: true },
  });
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  // Required for self-hosted deployments (Vercel sets this automatically);
  // safe here since we control the deployment and its Host header.
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
   clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: GOOGLE_SCOPES,
          access_type: "offline",
          prompt: "consent",
        },
      },
      // The AD pre-provisions roster members by email before they've ever
      // signed in (see admin roster screen). Since Google is the only
      // provider, it's safe to let a first Google sign-in claim that
      // existing placeholder User row instead of erroring out.
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  events: {
    // Bootstraps the very first admin. Without this there's a chicken-and-egg
    // problem: only an admin can promote someone, but nobody is one yet, so
    // the first one would have to be set by hand in the database.
    async signIn({ user }) {
      await promoteIfInitialAdmin(user.id, user.email);
    },
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.isAdmin = (user as { isAdmin?: boolean }).isAdmin ?? false;
      }
      return session;
    },
  },
  pages: {
    signIn: "/sign-in",
  },
});
