import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

/** Builds an authenticated Calendar client from the tokens stored on the
 * user's Google account (captured at sign-in, since we request the
 * calendar.readonly scope up front). Persists refreshed access tokens back
 * to the Account row so the next import doesn't need a fresh consent. */
export async function getGoogleCalendarClientForUser(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });
  if (!account?.refresh_token) {
    throw new Error(
      "Google Calendar isn't connected for this account. Sign out and back in to grant access.",
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({
    access_token: account.access_token ?? undefined,
    refresh_token: account.refresh_token,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  });

  oauth2Client.on("tokens", (tokens) => {
    void prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: tokens.access_token ?? account.access_token,
        expires_at: tokens.expiry_date
          ? Math.floor(tokens.expiry_date / 1000)
          : account.expires_at,
      },
    });
  });

  return google.calendar({ version: "v3", auth: oauth2Client });
}
