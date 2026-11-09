import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "../app/api/v1/auth/login/route";
import { POST as logout } from "../app/api/v1/auth/logout/route";
import { POST as chatDraft } from "../app/api/v1/requests/chat-draft/route";
import { GET as health } from "../app/api/v1/health/route";
import { GET as getMeta } from "../app/api/v1/meta/route";
import { clearAll, seedBase } from "../prisma/seed/base";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { withAuth } from "@/lib/with-auth";
import { withRequest } from "@/lib/with-request";
import { db } from "./db";

let out: string[];
let err: string[];
beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((c: string | Uint8Array) => (out.push(String(c)), true)) as never);
  vi.spyOn(process.stderr, "write").mockImplementation(((c: string | Uint8Array) => (err.push(String(c)), true)) as never);
});
afterEach(() => vi.restoreAllMocks());

const parse = (lines: string[]) => lines.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const all = () => [...parse(out), ...parse(err)];
const byEvent = (event: string) => all().filter((e) => e.event === event);
const req = (path: string, init: RequestInit = {}) => new Request(`http://x${path}`, init);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = "3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14";

describe("withRequest: the request id", () => {
  const ok = withRequest(() => NextResponse.json({ ok: true }));

  it("creates one when none is sent, and returns it as x-request-id", async () => {
    const res = await ok(req("/api/v1/x"));
    expect(res.headers.get("x-request-id")).toMatch(UUID);
  });

  it("keeps a valid incoming x-request-id and replaces an invalid one", async () => {
    const kept = await ok(req("/api/v1/x", { headers: { "x-request-id": ID } }));
    expect(kept.headers.get("x-request-id")).toBe(ID);
    const replaced = await ok(req("/api/v1/x", { headers: { "x-request-id": "not a uuid; forged: line" } }));
    expect(replaced.headers.get("x-request-id")).toMatch(UUID);
    expect(replaced.headers.get("x-request-id")).not.toContain("forged");
  });

  it("is on error responses too, and in the error body", async () => {
    const denied = withRequest(() => {
      throw new ApiError("FORBIDDEN", "no");
    });
    const res = await denied(req("/api/v1/x", { headers: { "x-request-id": ID } }));
    expect(res.status).toBe(403);
    expect(res.headers.get("x-request-id")).toBe(ID);
    expect(await res.json()).toEqual({ error: { code: "FORBIDDEN", message: "no", requestId: ID } });
  });

  it("is set even on a response whose headers cannot be changed", async () => {
    const redirect = withRequest(() => Response.redirect("http://x/elsewhere", 302));
    const res = await redirect(req("/api/v1/x", { headers: { "x-request-id": ID } }));
    expect(res.status).toBe(302);
    expect(res.headers.get("x-request-id")).toBe(ID);
    expect(res.headers.get("location")).toBe("http://x/elsewhere");
  });

  it("hands the id to the handler", async () => {
    let seen = "";
    await withRequest((_r, ctx) => ((seen = ctx.requestId), NextResponse.json({})))(req("/a", { headers: { "x-request-id": ID } }));
    expect(seen).toBe(ID);
  });
});

describe("withRequest: the request line", () => {
  it("logs method, route pattern, status, duration and request id, and never the real id or the query string", async () => {
    const handler = withRequest<{ id: string }>(() => NextResponse.json({}, { status: 200 }));
    await handler(req(`/api/v1/requests/${ID}?search=secret-term`, { method: "GET" }), { params: Promise.resolve({ id: ID }) });
    const [line] = byEvent("http.request");
    expect(line).toMatchObject({ level: "info", method: "GET", route: "/api/v1/requests/:id", status: 200 });
    expect(line.requestId).toMatch(UUID);
    expect(typeof line.ms).toBe("number");
    expect(line.userId).toBeUndefined();
    const text = out.join("") + err.join("");
    expect(text).not.toContain(ID);
    expect(text).not.toContain("secret-term");
  });

  it("uses the parameter name for each dynamic segment, so a made-up value never reaches the log", async () => {
    const handler = withRequest<{ id: string }>(() => NextResponse.json({}, { status: 404 }));
    await handler(req("/api/v1/requests/ana.perera@hris.test/comments"), { params: Promise.resolve({ id: "ana.perera@hris.test" }) });
    expect(byEvent("http.request")[0].route).toBe("/api/v1/requests/:id/comments");
    expect(out.join("") + err.join("")).not.toContain("ana.perera");
  });

  it.each([
    [200, "info", "out"],
    [302, "info", "out"],
    [404, "warn", "err"],
    [422, "warn", "err"],
    [500, "error", "err"],
  ] as const)("logs a %i at %s, on %s", async (status, level, stream) => {
    await withRequest(() => new NextResponse(null, { status }))(req("/api/v1/x"));
    const target = stream === "out" ? out : err;
    expect(parse(target)[0]).toMatchObject({ event: "http.request", level, status });
    expect((stream === "out" ? err : out).length).toBe(0);
  });

  it("logs nothing for a handler marked silent, but still sets the id", async () => {
    const res = await withRequest(() => NextResponse.json({}), { silent: true })(req("/api/v1/health"));
    expect(res.headers.get("x-request-id")).toMatch(UUID);
    expect(out.length + err.length).toBe(0);
  });
});

describe("withRequest: unexpected errors", () => {
  const boom = withRequest<{ id: string }>(() => {
    throw Object.assign(new Error("duplicate key for ana.perera@hris.test with key=SECRET999"), { code: "P2002" });
  });

  it("returns the generic 500 with the request id, and no message or stack", async () => {
    const res = await boom(req(`/api/v1/requests/${ID}`, { headers: { "x-request-id": ID } }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Internal server error", requestId: ID } });
  });

  it("logs one http.error with name, code, redacted message, a stack and the same request id, plus the request line", async () => {
    await boom(req(`/api/v1/requests/${ID}`, { method: "POST", headers: { "x-request-id": ID } }), { params: Promise.resolve({ id: ID }) });
    const errors = byEvent("http.error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ level: "error", requestId: ID, method: "POST", route: "/api/v1/requests/:id", errorName: "Error", errorCode: "P2002" });
    expect(errors[0].message).toContain("[email]");
    expect(errors[0].message).not.toContain("SECRET999");
    expect(errors[0].stack).toContain("Error:");
    expect(errors[0].stack).not.toContain("ana.perera@hris.test");
    expect(byEvent("http.request")[0]).toMatchObject({ level: "error", status: 500, requestId: ID });
  });

  it("copes with something thrown that is not an Error", async () => {
    const res = await withRequest(() => {
      throw "just a string";
    })(req("/api/v1/x"));
    expect(res.status).toBe(500);
    expect(byEvent("http.error")).toHaveLength(1);
  });

  it("logs an expected ApiError in the request line only, with no http.error and no stack", async () => {
    await withRequest(() => {
      throw new ApiError("NOT_FOUND", "gone");
    })(req("/api/v1/x"));
    expect(byEvent("http.error")).toHaveLength(0);
    expect(byEvent("http.request")[0]).toMatchObject({ level: "warn", status: 404 });
  });

  it("does not let an error code from the error carry free text into the log", async () => {
    await withRequest(() => {
      throw Object.assign(new Error("x"), { code: "my secret is hunter2 and spaces" });
    })(req("/api/v1/x"));
    expect(byEvent("http.error")[0].errorCode).toBeUndefined();
  });
});

describe("withAuth is built on it", () => {
  let ids: Awaited<ReturnType<typeof seedBase>>;
  beforeAll(async () => {
    await clearAll(db);
    ids = await seedBase(db, await bcrypt.hash("x", 4));
  });
  afterAll(() => db.$disconnect());

  it("logs a 401 as a warning with no user, and returns the request id", async () => {
    const res = await getMeta(req("/api/v1/meta"));
    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toMatch(UUID);
    expect(byEvent("http.request")[0]).toMatchObject({ level: "warn", status: 401, route: "/api/v1/meta" });
    expect(byEvent("http.request")[0].userId).toBeUndefined();
  });

  it("logs the signed-in user's id, and exposes the request id to the handler", async () => {
    const cookie = `${SESSION_COOKIE}=${await signSession(ids.personas.hrAdmin)}`;
    const res = await getMeta(req("/api/v1/meta", { headers: { cookie, "x-request-id": ID } }));
    expect(res.status).toBe(200);
    expect(byEvent("http.request")[0]).toMatchObject({ level: "info", status: 200, userId: ids.personas.hrAdmin, requestId: ID });
    let seen = "";
    await withAuth((_r, ctx) => ((seen = ctx.requestId), NextResponse.json({})))(req("/api/v1/x", { headers: { cookie, "x-request-id": ID } }));
    expect(seen).toBe(ID);
  });

  it("logs a 403 with the user id", async () => {
    const cookie = `${SESSION_COOKIE}=${await signSession(ids.personas.newHire)}`;
    const res = await withAuth(() => NextResponse.json({}), { roles: ["HR_ADMIN"] })(req("/api/v1/x", { headers: { cookie } }));
    expect(res.status).toBe(403);
    expect(byEvent("http.request")[0]).toMatchObject({ level: "warn", status: 403, userId: ids.personas.newHire });
  });

  it("turns a database failure into a logged 500 instead of crashing", async () => {
    const cookie = `${SESSION_COOKIE}=${await signSession(ids.personas.hrAdmin)}`;
    const res = await withAuth(() => {
      throw new Error("connection terminated");
    })(req("/api/v1/x", { headers: { cookie } }));
    expect(res.status).toBe(500);
    expect(byEvent("http.error")[0]).toMatchObject({ errorName: "Error", userId: ids.personas.hrAdmin });
  });
});

describe("the public routes", () => {
  it("health returns ok with a request id and is not logged", async () => {
    const res = await health(req("/api/v1/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("x-request-id")).toMatch(UUID);
    expect(out.length + err.length).toBe(0);
  });

  it("login failures are a logged 401 with a request id", async () => {
    const res = await login(req("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nobody@hris.test", password: "wrong-password" }) }));
    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toMatch(UUID);
    expect(((await res.json()) as any).error.requestId).toMatch(UUID);
    expect(byEvent("http.request")[0]).toMatchObject({ level: "warn", status: 401, method: "POST", route: "/api/v1/auth/login" });
  });
});

describe("security events", () => {
  let ids: Awaited<ReturnType<typeof seedBase>>;
  beforeAll(async () => {
    await clearAll(db);
    ids = await seedBase(db, await bcrypt.hash("a-real-password", 4));
  });
  afterAll(() => db.$disconnect());

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    req(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const asUser = async (id: string, extra: Record<string, string> = {}) => ({ cookie: `${SESSION_COOKIE}=${await signSession(id)}`, ...extra });

  it("logs a failed login with the request id, route, ip and user agent, and never the email or password", async () => {
    const email = "ana.perera@hris.test";
    const res = await login(post("/api/v1/auth/login", { email, password: "wrong-password-123" }, { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "TestBrowser/1.0" }));
    expect(res.status).toBe(401);
    const events = byEvent("auth.login_failed");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ level: "warn", requestId: res.headers.get("x-request-id"), route: "/api/v1/auth/login", ip: "203.0.113.7", userAgent: "TestBrowser/1.0" });
    expect(events[0].userId).toBeUndefined();
    const text = out.join("") + err.join("");
    for (const secret of [email, "ana.perera", "wrong-password-123"]) expect(text).not.toContain(secret);
  });

  it("logs the same event for an unknown email and for a wrong password", async () => {
    await login(post("/api/v1/auth/login", { email: "ghost@hris.test", password: "nope-nope-nope" }));
    await login(post("/api/v1/auth/login", { email: "hr.admin@hris.test", password: "nope-nope-nope" }));
    expect(byEvent("auth.login_failed")).toHaveLength(2);
    expect(byEvent("auth.login")).toHaveLength(0);
  });

  it("does not log a failed login for a malformed request", async () => {
    expect((await login(post("/api/v1/auth/login", { email: "a@b.c" }))).status).toBe(422);
    expect(byEvent("auth.login_failed")).toHaveLength(0);
  });

  it("logs a successful login at info with the user's id and no email, password or session token", async () => {
    const res = await login(post("/api/v1/auth/login", { email: "hr.admin@hris.test", password: "a-real-password" }));
    expect(res.status).toBe(200);
    const [event] = byEvent("auth.login");
    expect(event).toMatchObject({ level: "info", userId: ids.personas.hrAdmin, requestId: res.headers.get("x-request-id") });
    expect(out.join("")).not.toContain("hr.admin@hris.test");
    const token = res.headers.get("set-cookie")!.match(/hris_session=([^;]+)/)![1];
    expect(out.join("") + err.join("")).not.toContain(token);
    expect(out.join("") + err.join("")).not.toContain("a-real-password");
  });

  it("logs a logout with the user's id", async () => {
    const res = await logout(req("/api/v1/auth/logout", { method: "POST", headers: await asUser(ids.personas.hrAdmin) }));
    expect(res.status).toBe(204);
    expect(byEvent("auth.logout")[0]).toMatchObject({ level: "info", userId: ids.personas.hrAdmin });
  });

  it("logs auth.session_invalid for a 401 that sent a cookie, and nothing extra when no cookie was sent", async () => {
    expect((await getMeta(req("/api/v1/meta", { headers: { cookie: `${SESSION_COOKIE}=not-a-real-token` } }))).status).toBe(401);
    const [event] = byEvent("auth.session_invalid");
    expect(event).toMatchObject({ level: "warn", route: "/api/v1/meta" });
    expect(out.join("") + err.join("")).not.toContain("not-a-real-token");
    out.length = 0;
    err.length = 0;
    expect((await getMeta(req("/api/v1/meta"))).status).toBe(401);
    expect(byEvent("auth.session_invalid")).toHaveLength(0);
  });

  it("logs auth.forbidden for a 403, with the user's id", async () => {
    const res = await withAuth(() => NextResponse.json({}), { roles: ["HR_ADMIN"] })(req("/api/v1/users", { headers: await asUser(ids.personas.newHire) }));
    expect(res.status).toBe(403);
    expect(byEvent("auth.forbidden")[0]).toMatchObject({ level: "warn", userId: ids.personas.newHire, route: "/api/v1/users" });
  });

  it("takes the first forwarded address, and truncates the ip to 64 and the user agent to 300 characters", async () => {
    await login(post("/api/v1/auth/login", { email: "x@hris.test", password: "nope-nope-nope" }, { "x-forwarded-for": "9".repeat(200), "user-agent": "u".repeat(900) }));
    const [event] = byEvent("auth.login_failed");
    expect(event.ip).toHaveLength(64);
    expect(event.userAgent).toHaveLength(300);
  });

  it("leaves ip and user agent out when the request has none", async () => {
    await login(post("/api/v1/auth/login", { email: "x@hris.test", password: "nope-nope-nope" }));
    const [event] = byEvent("auth.login_failed");
    expect("ip" in event).toBe(false);
  });

  it("never writes a password, a cookie, an authorization header or a chat message anywhere in the output", async () => {
    const cookie = (await asUser(ids.personas.newHire)).cookie;
    const token = cookie.split("=")[1];
    const message = "MY-PRIVATE-MESSAGE-" + "word ".repeat(150);
    delete process.env.AI_SERVICE_URL;
    const res = await chatDraft(post("/api/v1/requests/chat-draft", { message, page: "/requests" }, { cookie, authorization: "Bearer BEARER-SECRET-VALUE" }));
    expect(res.status).toBe(503);
    await login(post("/api/v1/auth/login", { email: "private.person@hris.test", password: "PASSWORD-SECRET-VALUE" }, { cookie, authorization: "Bearer BEARER-SECRET-VALUE" }));
    const text = out.join("") + err.join("");
    expect(text.length).toBeGreaterThan(0);
    for (const secret of ["MY-PRIVATE-MESSAGE", "BEARER-SECRET-VALUE", "PASSWORD-SECRET-VALUE", "private.person", token]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});
