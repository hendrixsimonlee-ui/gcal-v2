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

/** Writes the tokens from this sign-in onto the Account row.
 *
 * Auth.js only stores tokens through `linkAccount`, and `linkAccount` runs
 * exactly once — the first time somebody signs in with Google. Every sign-in
 * after that finds the account already linked, creates a session, and drops
 * the fresh tokens on the floor (see @auth/core handle-login: the
 * `userByAccount` branch returns without touching the account).
 *
 * That is fine until the stored refresh token dies, which happens routinely:
 * Google expires refresh tokens after 7 days while the OAuth consent screen
 * is in Testing, and also kills them if access is revoked or the client
 * changes. Once dead, every Calendar call returns `invalid_grant` — and
 * signing out and back in doesn't help, because the good token Google just
 * issued is discarded and the dead one stays.
 *
 * So we persist it ourselves. Sign-in asks for `access_type=offline` with
 * `prompt=consent`, so Google returns a new refresh token every time, and a
 * re-login is now a genuine reconnect.
 *
 * Only fields Google actually sent are written: a re-auth that omits the
 * refresh token must not blank out the working one we already have. */
async function persistGoogleTokens(account: unknown) {
  const a = account as Record<string, unknown> | null | undefined;
  if (!a || a.provider !== "google") return;

  const providerAccountId = a.providerAccountId;
  if (typeof providerAccountId !== "string" || !providerAccountId) return;

  const text = (value: unknown) =>
    typeof value === "string" && value.length > 0 ? value : undefined;

  const data: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    scope?: string;
    token_type?: string;
    id_token?: string;
  } = {};

  const accessToken = text(a.access_token);
  if (accessToken) data.access_token = accessToken;
  const refreshToken = text(a.refresh_token);
  if (refreshToken) data.refresh_token = refreshToken;
  if (typeof a.expires_at === "number" && Number.isFinite(a.expires_at)) {
    data.expires_at = Math.floor(a.expires_at);
  }
  const scope = text(a.scope);
  if (scope) data.scope = scope;
  const tokenType = text(a.token_type);
  if (tokenType) data.token_type = tokenType;
  const idToken = text(a.id_token);
  if (idToken) data.id_token = idToken;

  if (Object.keys(data).length === 0) return;

  // updateMany, not update: on a first sign-in the adapter has already written
  // this exact row a moment ago, and on any later one there's nothing to
  // create. Either way "no matching row" is a no-op rather than a crash that
  // would take the whole sign-in down with it.
  await prisma.account.updateMany({
    where: { provider: "google", providerAccountId },
    data,
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
      // Auth.js only infers credentials from AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET
      // (see @auth/core/lib/utils/env.js). Every doc here uses the
      // GOOGLE_CLIENT_* names, so read those explicitly — otherwise the
      // provider silently sends an empty client_id and Google answers
      // "Error 401: invalid_client". Leaving these undefined still lets
      // Auth.js fall back to its own AUTH_GOOGLE_* names.
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
    async signIn({ user, account }) {
      await promoteIfInitialAdmin(user.id, user.email);
      // Keeps the stored Google tokens current — without this, signing back
      // in can never repair a dead one. See persistGoogleTokens.
      await persistGoogleTokens(account);
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
