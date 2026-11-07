import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, loadAuthUser, publicUser, sessionCookieOptions, signSession, verifyCredentials } from "@/lib/auth";
import { ApiError, toErrorResponse } from "@/lib/errors";
import { parse, readJson } from "@/lib/validation";

const body = z.object({ email: z.string().min(1), password: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const { email, password } = parse(body, await readJson(req));
    const found = await verifyCredentials(email, password);
    if (!found) throw new ApiError("UNAUTHORIZED", "Invalid email or password");
    const user = (await loadAuthUser(found.id))!;
    const res = NextResponse.json({ user: publicUser(user) });
    res.cookies.set(SESSION_COOKIE, await signSession(user.id), sessionCookieOptions());
    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}
