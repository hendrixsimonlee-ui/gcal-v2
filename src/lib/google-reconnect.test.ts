/** Does signing back in actually repair a dead Google connection?
 *
 * This is the regression test for the bug that made the spaces sync
 * unfixable. Auth.js writes provider tokens through `linkAccount`, and
 * `linkAccount` runs exactly once — the first time an account signs in. Every
 * sign-in after that finds the account already linked, mints a session, and
 * returns without touching the stored tokens (see @auth/core's handle-login,
 * the `userByAccount` branch).
 *
 * So when Google expired the refresh token, the app was stuck: the AD signed
 * out and back in, Google issued a good token, and the app dropped it. Every
 * calendar call kept using the dead one and answering `invalid_grant`, for
 * ever, with no action available that could fix it.
 *
 * `persistGoogleTokens` runs on the sign-in event and writes the token set
 * onto the Account row itself. These tests run against a real database
 * because the whole bug was about what ends up in that row.
 *
 * Needs DATABASE_URL pointed at a scratch database; skipped without one.
 */

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { persistGoogleTokens } from "@/auth";
import { describeGoogleError, googleCredentialsFor } from "@/lib/google-calendar";

const connectionString = process.env.DATABASE_URL;

let passed = 0;
let failed = 0;

function report() {
  console.log(
    failed === 0
      ? `\nAll ${passed} google reconnect tests passed`
      : `\n${failed} google reconnect test(s) FAILED`,
  );
  if (failed > 0) process.exitCode = 1;
}

function check(label: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`PASS: ${label}`);
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

/** The shape @auth/core hands to events.signIn: the raw token response with
 * provider identifiers merged in (see getUserAndAccount in
 * @auth/core/lib/actions/callback/oauth/callback.js). */
function googleSignIn(overrides: Record<string, unknown> = {}) {
  return {
    provider: "google",
    type: "oidc",
    providerAccountId: "google-uid-1",
    access_token: "fresh-access",
    refresh_token: "fresh-refresh",
    expires_at: 1_800_000_000,
    scope: "openid email profile https://www.googleapis.com/auth/calendar.readonly",
    token_type: "bearer",
    id_token: "fresh-id",
    ...overrides,
  };
}

/** The second way the connection died: an access token with no expiry.
 *
 * google-auth-library never refreshes a token it can't see an expiry on, so
 * it sends the stale one and Google answers 401 — without ever trying the
 * refresh token. Nothing in the app could recover from that either. */
function credentialTests() {
  const fresh = googleCredentialsFor({
    access_token: "cached",
    refresh_token: "good-refresh",
    expires_at: 1_900_000_000,
  });
  check(
    "a token with a known expiry is reused, expiry included",
    fresh.access_token === "cached" && fresh.expiry_date === 1_900_000_000_000,
  );

  const noExpiry = googleCredentialsFor({
    access_token: "cached",
    refresh_token: "good-refresh",
    expires_at: null,
  });
  check(
    "an access token with no expiry is dropped, forcing a refresh",
    noExpiry.access_token === undefined &&
      noExpiry.refresh_token === "good-refresh",
  );

  const noAccess = googleCredentialsFor({
    access_token: null,
    refresh_token: "good-refresh",
    expires_at: 1_900_000_000,
  });
  check(
    "no access token at all still leaves the refresh token to work with",
    noAccess.access_token === undefined &&
      noAccess.refresh_token === "good-refresh",
  );

  check(
    "the refresh token is always passed through",
    [fresh, noExpiry, noAccess].every((c) => c.refresh_token === "good-refresh"),
  );
}

/** Google's raw errors are jargon. Each one the AD can actually hit should
 * come back as a sentence naming the thing to go and change. */
function errorMessageTests() {
  const cases: [string, RegExp][] = [
    ["invalid_grant", /sign out and sign back in/i],
    ["invalid_request", /GOOGLE_CLIENT_ID/],
    ["invalid_client", /GOOGLE_CLIENT_ID/],
    ["Invalid Credentials", /sign out and sign back in/i],
    ["Request had insufficient authentication scopes", /shared with the club/i],
    ["notFound", /no longer exists/i],
  ];
  for (const [raw, expected] of cases) {
    const message = describeGoogleError(new Error(raw)).message;
    check(`"${raw}" becomes something actionable`, expected.test(message));
    check(`"${raw}" no longer shows the raw code`, message !== raw);
  }
}

async function main() {
  credentialTests();
  errorMessageTests();

  if (!connectionString) {
    console.log("SKIP: the database half needs DATABASE_URL");
    report();
    return;
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  // A laptop without Postgres running should still be able to run the suite.
  // Skipping is honest; crashing out of `npm test` with a driver stack trace
  // just makes the whole suite look broken.
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.log("SKIP: the database half needs a reachable DATABASE_URL");
    await prisma.$disconnect();
    report();
    return;
  }

  const email = `reconnect-test-${Date.now()}@example.com`;
  const user = await prisma.user.create({ data: { email, name: "Test AD" } });

  // The state the app was actually stuck in: linked long ago, token since
  // expired by Google.
  await prisma.account.create({
    data: {
      userId: user.id,
      type: "oidc",
      provider: "google",
      providerAccountId: "google-uid-1",
      refresh_token: "dead-refresh",
      access_token: "stale-access",
      expires_at: 1_700_000_000,
      token_type: "bearer",
      scope: "openid email",
    },
  });

  try {
    // --- The bug, and the fix -------------------------------------------
    await persistGoogleTokens(googleSignIn());

    let account = await prisma.account.findFirstOrThrow({
      where: { userId: user.id, provider: "google" },
    });

    check(
      "signing in again replaces the dead refresh token",
      account.refresh_token === "fresh-refresh",
    );
    check(
      "…and the access token with it",
      account.access_token === "fresh-access",
    );
    check(
      "…and the expiry, so the client knows to refresh",
      account.expires_at === 1_800_000_000,
    );
    check(
      "…and the scopes, so a newly-granted calendar scope is recorded",
      account.scope?.includes("calendar.readonly") === true,
    );

    // --- A response without a refresh token must not blank the good one --
    await persistGoogleTokens(
      googleSignIn({ refresh_token: undefined, access_token: "second-access" }),
    );
    account = await prisma.account.findFirstOrThrow({
      where: { userId: user.id, provider: "google" },
    });
    check(
      "a sign-in that returns no refresh token keeps the working one",
      account.refresh_token === "fresh-refresh",
    );
    check(
      "…while still taking the new access token",
      account.access_token === "second-access",
    );

    // Google sends an empty string rather than omitting the field often
    // enough that treating it as "no value" matters.
    await persistGoogleTokens(googleSignIn({ refresh_token: "" }));
    account = await prisma.account.findFirstOrThrow({
      where: { userId: user.id, provider: "google" },
    });
    check(
      "an empty refresh token is ignored, not written",
      account.refresh_token === "fresh-refresh",
    );

    // --- Never touch anything that isn't this Google account -------------
    const other = await prisma.user.create({
      data: { email: `other-${Date.now()}@example.com` },
    });
    await prisma.account.create({
      data: {
        userId: other.id,
        type: "oidc",
        provider: "google",
        providerAccountId: "google-uid-2",
        refresh_token: "someone-elses",
      },
    });
    await persistGoogleTokens(googleSignIn());
    const untouched = await prisma.account.findFirstOrThrow({
      where: { userId: other.id },
    });
    check(
      "another member's token is left alone",
      untouched.refresh_token === "someone-elses",
    );

    // --- Non-Google and malformed input are no-ops, not crashes ----------
    // A throw here would take the whole sign-in down with it.
    await persistGoogleTokens(null);
    await persistGoogleTokens(undefined);
    await persistGoogleTokens({ provider: "github", refresh_token: "x" });
    await persistGoogleTokens({ provider: "google" }); // no providerAccountId
    await persistGoogleTokens(googleSignIn({ providerAccountId: "unknown-id" }));
    check("bad or unrelated sign-in payloads don't throw", true);

    await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
  } finally {
    await prisma.$disconnect();
  }

  report();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
