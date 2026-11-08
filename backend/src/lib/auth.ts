import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { serializeUser, userInclude, type PublicUser } from "./user-serializer";

export const SESSION_COOKIE = "hris_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
const BCRYPT_COST = 10;

/** Compared against when the email is unknown, so login timing doesn't reveal which emails exist. */
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_COST);

export interface AuthUser extends PublicUser {
  /**
   * Department this user heads. A Manager is the head of their own department (there is no separate head with extra
   * permissions); anyone else has none. Internal: decides request triage scope.
   */
  headOfDepartmentId: string | null;
}

function secret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error("JWT_SECRET must be set and at least 32 characters long");
  }
  return new TextEncoder().encode(value);
}

export const hashPassword = (plain: string, cost = BCRYPT_COST) => bcrypt.hash(plain, cost);

/** Returns the user if the credentials are valid, otherwise null (same cost either way). */
export async function verifyCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  return user && ok ? user : null;
}

/** The token carries only the user id; role and status are always read fresh from the database. */
export function signSession(userId: string, expiresIn: string = `${SESSION_TTL_SECONDS}s`) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret());
}

export async function verifySession(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(production = process.env.NODE_ENV === "production") {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx !== -1 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: userInclude,
  });
  if (!u) return null;
  return { ...serializeUser(u), headOfDepartmentId: u.role === "MANAGER" ? u.departmentId : null };
}

/** The public shape returned to clients (spec §4.2); omits internal fields. */
export function publicUser(u: AuthUser) {
  const { headOfDepartmentId: _omit, ...rest } = u;
  return rest;
}

export async function getAuthUser(req: Request): Promise<AuthUser | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const userId = await verifySession(token);
  return userId ? loadAuthUser(userId) : null;
}
