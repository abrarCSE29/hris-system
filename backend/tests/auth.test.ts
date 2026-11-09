import { SignJWT } from "jose";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "../app/api/v1/auth/login/route";
import { POST as logout } from "../app/api/v1/auth/logout/route";
import { GET as me } from "../app/api/v1/auth/me/route";
import { SESSION_COOKIE, hashPassword, sessionCookieOptions, signSession } from "@/lib/auth";
import { withAuth } from "@/lib/with-auth";
import { db, makeDepartment, makeUser, resetDb } from "./db";

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const PASSWORD = "correct horse";

async function seedUser(overrides = {}) {
  const dept = await makeDepartment();
  const user = await makeUser(dept.id, {
    email: "ana@example.com",
    passwordHash: await hashPassword(PASSWORD, 4),
    ...overrides,
  });
  return { dept, user };
}

const post = (body: unknown) =>
  new Request("http://x/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const withCookie = (token: string, init: RequestInit = {}) =>
  new Request("http://x/api", { ...init, headers: { cookie: `${SESSION_COOKIE}=${token}` } });

describe("POST /auth/login", () => {
  it("logs in, returns the public user and sets a hardened cookie", async () => {
    const { user } = await seedUser();
    const res = await login(post({ email: "ana@example.com", password: PASSWORD }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.user).toMatchObject({ id: user.id, email: "ana@example.com", role: { code: "EMPLOYEE", name: "Employee" }, country: { shortcode: "BD", name: "Bangladesh" }, status: { code: "ACTIVE", name: "Active" }, joiningDate: "2024-01-01" });
    expect(body.user.role.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.user.department).toHaveProperty("name");
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|password_hash|headOfDepartmentId/);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Max-Age=28800/);
  });

  it("marks the cookie Secure in production", () => {
    expect(sessionCookieOptions(true).secure).toBe(true);
    expect(sessionCookieOptions(false).secure).toBe(false);
  });

  it("matches the email case-insensitively and ignores surrounding whitespace", async () => {
    await seedUser();
    const res = await login(post({ email: "  ANA@Example.COM ", password: PASSWORD }));
    expect(res.status).toBe(200);
  });

  it("returns the same 401 for a wrong password and an unknown email", async () => {
    await seedUser();
    const wrong = await login(post({ email: "ana@example.com", password: "nope" }));
    const unknown = await login(post({ email: "ghost@example.com", password: "nope" }));
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    // Same answer for both; only the per-request id differs.
    const strip = async (r: Response) => {
      const body = (await r.json()) as { error: Record<string, unknown> };
      delete body.error.requestId;
      return body;
    };
    expect(await strip(wrong)).toEqual(await strip(unknown));
    expect(wrong.headers.get("set-cookie")).toBeNull();
  });

  it("returns 422 for missing fields and malformed JSON", async () => {
    expect((await login(post({ email: "a@b.c" }))).status).toBe(422);
    expect((await login(post("{bad"))).status).toBe(422);
  });
});

describe("GET /auth/me and withAuth", () => {
  it("returns 401 without a cookie", async () => {
    const res = await me(new Request("http://x/api"));
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe("UNAUTHORIZED");
  });

  it("returns the user, isNewHire=false and headOfDepartmentId", async () => {
    const { user, dept } = await seedUser({ role: "MANAGER" });
    await db.department.update({ where: { id: dept.id }, data: { headId: user.id } });
    const res = await me(withCookie(await signSession(user.id)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      user: { id: user.id, role: { code: "MANAGER" } },
      isNewHire: false,
      headOfDepartmentId: dept.id,
    });
  });

  it("sets isNewHire only while an ACTIVE onboarding instance exists", async () => {
    const { user } = await seedUser();
    const tpl = await db.onboardingTemplate.create({ data: { name: "T", description: "d", createdById: user.id } });
    const inst = await db.onboardingInstance.create({
      data: { employeeId: user.id, templateId: tpl.id, startDate: new Date("2026-01-01") },
    });
    const token = await signSession(user.id);
    expect(((await (await me(withCookie(token))).json()) as any).isNewHire).toBe(true);
    await db.onboardingInstance.update({ where: { id: inst.id }, data: { status: "COMPLETED" } });
    expect(((await (await me(withCookie(token))).json()) as any).isNewHire).toBe(false);
  });

  it("rejects tampered, expired, foreign-secret and unsigned tokens with 401", async () => {
    const { user } = await seedUser();
    const good = await signSession(user.id);
    const [h, p, s] = good.split(".");
    const tampered = `${h}.${p}.${s.slice(0, -2)}${s.endsWith("AA") ? "BB" : "AA"}`;
    const expired = await signSession(user.id, "-10s");
    const foreign = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(user.id)
      .setExpirationTime("1h").sign(new TextEncoder().encode("another-secret-another-secret-123456"));
    const unsigned = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${p}.`;
    for (const token of [tampered, expired, foreign, unsigned, "garbage"]) {
      expect((await me(withCookie(token))).status).toBe(401);
    }
  });

  it("rejects a valid token whose user no longer exists", async () => {
    const { user } = await seedUser();
    const token = await signSession(user.id);
    await resetDb();
    expect((await me(withCookie(token))).status).toBe(401);
  });

  it("enforces roles with 403, applies role changes immediately, and checks 401 before 403", async () => {
    const { user } = await seedUser();
    const guarded = withAuth(() => Response.json({ ok: true }), { roles: ["HR_ADMIN"] });
    const token = await signSession(user.id);

    expect((await guarded(new Request("http://x/api"))).status).toBe(401);
    expect((await guarded(withCookie(token))).status).toBe(403);

    await db.user.update({ where: { id: user.id }, data: { role: { connect: { code: "HR_ADMIN" } } } });
    expect((await guarded(withCookie(token))).status).toBe(200);
  });

  it("turns errors thrown inside a handler into the error envelope", async () => {
    const { user } = await seedUser();
    const boom = withAuth(() => {
      throw new Error("secret internals");
    });
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const res = await boom(withCookie(await signSession(user.id)));
    write.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret internals");
  });
});

describe("POST /auth/logout", () => {
  it("clears the cookie with 204 when logged in", async () => {
    const { user } = await seedUser();
    const res = await logout(withCookie(await signSession(user.id), { method: "POST" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it("requires a session", async () => {
    expect((await logout(new Request("http://x/api", { method: "POST" }))).status).toBe(401);
  });
});
