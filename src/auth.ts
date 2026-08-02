import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

// Requesting the Calendar readonly scope up front so the same Google
// sign-in also authorizes importing a dancer's conflicts from their
// Google Calendar (see src/lib/google-calendar.ts).
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  // Required for self-hosted deployments (Vercel sets this automatically);
  // safe here since we control the deployment and its Host header.
  trustHost: true,
  providers: [
    Google({
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
