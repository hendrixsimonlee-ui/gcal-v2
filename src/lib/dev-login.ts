/** Dev-only sign-in bypass, so the app can be run and clicked through
 * locally without standing up a Google OAuth client first.
 *
 * This deliberately requires TWO independent conditions. `NODE_ENV` is
 * baked in at build time and is always "production" in a real deployment,
 * so even someone setting ALLOW_DEV_LOGIN=true on a live server cannot turn
 * this on. Both the API route and the sign-in UI check this same helper. */
export function devLoginEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_DEV_LOGIN === "true"
  );
}

/** Cookie Auth.js reads for a database session. The secure-prefixed variant
 * only applies over HTTPS, which dev login never runs on. */
export const DEV_SESSION_COOKIE = "authjs.session-token";
