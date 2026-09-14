import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Sessions use the database strategy (see src/auth.ts), so validating one
// here requires a real Prisma/DB call. Proxy (formerly middleware) always
// runs on the Node.js runtime, so this is supported without extra config.
export default auth((req) => {
  const isSignedIn = !!req.auth;
  const isSignInPage = req.nextUrl.pathname === "/sign-in";

  if (!isSignedIn && !isSignInPage) {
    const signInUrl = new URL("/sign-in", req.nextUrl.origin);
    return NextResponse.redirect(signInUrl);
  }

  if (isSignedIn && isSignInPage) {
    return NextResponse.redirect(new URL("/schedule", req.nextUrl.origin));
  }
});

export const config = {
  matcher: [
    // The logo has to stay reachable signed-out — it's on the sign-in page,
    // and a phone fetches it for the home-screen icon without a session.
    "/((?!api/auth|api/cron|api/dev-login|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon\\.png).*)",
  ],
};
