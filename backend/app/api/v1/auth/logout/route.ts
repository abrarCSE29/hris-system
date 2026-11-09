import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { withAuth } from "@/lib/with-auth";

export const POST = withAuth(async (_req, { audit }) => {
  await audit("auth.logout", "info");
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
});
