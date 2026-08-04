import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { promoteIfInitialAdmin } from "@/auth";
import { DEV_SESSION_COOKIE, devLoginEnabled } from "@/lib/dev-login";

const SESSION_DAYS = 7;

/** Signs in as an existing roster member without going through Google.
 * Local development only — see src/lib/dev-login.ts for the guard. */
export async function POST(request: NextRequest) {
  if (!devLoginEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    return new NextResponse("Email required", { status: 400 });
  }

  // Only ever signs in as somebody already on the roster, so this can't be
  // used to conjure accounts even in dev.
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return new NextResponse(
      `No roster member with the email ${email}. Run \`npm run seed:demo\` first.`,
      { status: 404 },
    );
  }

  await promoteIfInitialAdmin(user.id, user.email);

  const sessionToken = crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires },
  });

  const response = NextResponse.redirect(new URL("/schedule", request.url));
  response.cookies.set(DEV_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
  });
  return response;
}
