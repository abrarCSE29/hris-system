import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "hris_session";

/**
 * Only a convenience redirect: no cookie → /login. It does NOT validate the session;
 * the backend does that on every API call (an expired cookie gets a 401 and the client
 * redirects). /login is deliberately never redirected away, so a stale cookie can't loop.
 */
export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === "/login") return NextResponse.next();
  if (!req.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
