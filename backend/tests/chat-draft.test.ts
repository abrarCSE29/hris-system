import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as chatDraftRoute } from "../app/api/v1/requests/chat-draft/route";
import { clearAll, seedBase } from "../prisma/seed/base";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { db } from "./db";

let ids: Awaited<ReturnType<typeof seedBase>>;
let userId: string;
let user: { fullName: string; email: string; country: { name: string } };

const SECRET = "SECRET-MESSAGE-TEXT-4d2b";
const AI_URL = "http://ai.test";

beforeAll(async () => {
  await clearAll(db);
  ids = await seedBase(db, await bcrypt.hash("x", 4));
  userId = ids.personas.newHire;
  user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, email: true, country: { select: { name: true } } } });
});
afterAll(() => db.$disconnect());

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  process.env.AI_SERVICE_URL = AI_URL;
  process.env.AI_SERVICE_TOKEN = "test-token";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await db.chatDraft.deleteMany();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const aiOk = (over: Record<string, unknown> = {}) => ({
  title: "Laptop overheating",
  description: "The laptop is getting very hot.",
  category: "IT_EQUIPMENT",
  priority: "URGENT",
  department: "ITOPS",
  confidence: 0.93,
  lowConfidence: false,
  reasoning: "Hardware fault with a possible safety risk.",
  model: "qwen/qwen3.8-27b",
  latencyMs: 1180,
  attempts: 1,
  ...over,
});
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const aiFails = (status: number, code: string, detail = "ValueError: [redacted]\n  at drafter.py:1 in draft_request") =>
  reply(status, { error: { code, message: "x", type: "ValueError", detail }, requestId: "r" });

async function call(body: unknown, who: string | null = userId, headers: Record<string, string> = {}) {
  return chatDraftRoute(
    new Request("http://x/api/v1/requests/chat-draft", {
      method: "POST",
      headers: { "content-type": "application/json", ...(who ? { cookie: `${SESSION_COOKIE}=${await signSession(who)}` } : {}), ...headers },
      body: JSON.stringify(body),
    }),
  );
}
const ok = { message: "My laptop is firing up, need technical help", page: "/requests" };
const json = async (res: Response) => (await res.json()) as any;
const rows = () => db.chatDraft.findMany({ orderBy: { createdAt: "asc" } });

describe("POST /requests/chat-draft: success", () => {
  it("requires login", async () => {
    expect((await call(ok, null)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the draft with ids, and creates no request", async () => {
    fetchMock.mockResolvedValue(reply(200, aiOk()));
    const before = await db.serviceRequest.count();
    const res = await call(ok);
    const body = await json(res);
    const it = await db.requestCategory.findUniqueOrThrow({ where: { code: "IT_EQUIPMENT" } });
    const itops = await db.department.findUniqueOrThrow({ where: { code: "ITOPS" } });
    expect(res.status).toBe(200);
    expect(body).toEqual({
      title: "Laptop overheating", description: "The laptop is getting very hot.", categoryId: it.id, priority: "URGENT",
      departmentId: itops.id, confidence: 0.93, lowConfidence: false, reasoning: "Hardware fault with a possible safety risk.",
    });
    expect(await db.serviceRequest.count()).toBe(before);
  });

  it("calls the AI service with the token and a request id, and sends only the message, country, department name and the offered lists", async () => {
    fetchMock.mockResolvedValue(reply(200, aiOk()));
    await call({ message: SECRET, page: "/people" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${AI_URL}/v1/draft`);
    expect(init.method).toBe("POST");
    expect(init.headers["x-service-token"]).toBe("test-token");
    expect(init.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const sent = JSON.parse(init.body);
    expect(Object.keys(sent).sort()).toEqual(["categories", "departments", "message", "requesterCountry", "requesterDepartment"]);
    expect(sent.message).toBe(SECRET);
    expect(sent.requesterCountry).toBe(user.country.name);
    expect(sent.categories).toHaveLength(5);
    expect(sent.categories[0]).toHaveProperty("description");
    // nothing that identifies the person
    expect(init.body).not.toContain(user.fullName);
    expect(init.body).not.toContain(user.email);
    expect(init.body).not.toContain(userId);
  });

  it("writes one record: who, from where, how it went, what was chosen, the length; never the text", async () => {
    fetchMock.mockResolvedValue(reply(200, aiOk({ attempts: 2, lowConfidence: true, confidence: 0.4 })));
    await call({ message: SECRET, page: "/requests" }, userId, { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "TestBrowser/1.0" });
    const [row] = await rows();
    const sentId = fetchMock.mock.calls[0][1].headers["x-request-id"];
    expect(row).toMatchObject({
      userId, page: "/requests", ip: "203.0.113.7", userAgent: "TestBrowser/1.0", requestId: sentId, outcome: "OK", errorCode: null,
      error: null, errorDetail: null, attempts: 2, model: "qwen/qwen3.8-27b", priority: "URGENT", lowConfidence: true, messageChars: SECRET.length,
    });
    expect(Number(row.confidence)).toBe(0.4);
    expect(row.latencyMs).toBeGreaterThanOrEqual(0);
    expect(row.categoryId).toBeTruthy();
    expect(row.departmentId).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });

  it("uses a different request id for every call", async () => {
    fetchMock.mockImplementation(async () => reply(200, aiOk()));
    await call(ok);
    await call(ok);
    const used = (await rows()).map((r) => r.requestId);
    expect(new Set(used).size).toBe(2);
  });

  it("uses the request's own id everywhere: the x-request-id header, the call to the AI service and the record", async () => {
    fetchMock.mockResolvedValue(reply(200, aiOk()));
    const res = await call(ok);
    const [row] = await rows();
    expect(res.headers.get("x-request-id")).toBe(row.requestId);
    expect(fetchMock.mock.calls[0][1].headers["x-request-id"]).toBe(row.requestId);
  });

  it("keeps a valid x-request-id from the caller, and ignores an invalid one", async () => {
    fetchMock.mockResolvedValue(reply(200, aiOk()));
    const mine = crypto.randomUUID();
    const res = await call(ok, userId, { "x-request-id": mine });
    expect(res.headers.get("x-request-id")).toBe(mine);
    expect((await rows())[0].requestId).toBe(mine);
    expect(fetchMock.mock.calls[0][1].headers["x-request-id"]).toBe(mine);
    await call(ok, userId, { "x-request-id": "not-a-uuid" });
    expect((await rows())[1].requestId).not.toBe("not-a-uuid");
  });

  it("returns the same id in the 503 body and the header when the assistant is down", async () => {
    fetchMock.mockRejectedValue(unreachable());
    const res = await call(ok);
    expect((await json(res)).error.details.requestId).toBe(res.headers.get("x-request-id"));
    expect((await rows())[0].requestId).toBe(res.headers.get("x-request-id"));
  });

  it("takes the person from the session, never from the body", async () => {
    fetchMock.mockResolvedValue(reply(200, aiOk()));
    expect((await call({ ...ok, userId: ids.personas.hrAdmin })).status).toBe(422);
    await call(ok);
    expect((await rows()).every((r) => r.userId === userId)).toBe(true);
  });

  it("works for every role", async () => {
    fetchMock.mockImplementation(async () => reply(200, aiOk()));
    for (const who of [ids.personas.newHire, ids.personas.manager, ids.personas.hrAdmin]) expect((await call(ok, who)).status).toBe(200);
  });

  it("leaves ip and user agent empty when the headers are missing", async () => {
    fetchMock.mockResolvedValue(reply(200, aiOk()));
    await call(ok);
    const [row] = await rows();
    expect(row.ip).toBeNull();
  });
});

describe("POST /requests/chat-draft: bad input", () => {
  it.each([
    ["empty message", { message: "", page: "/x" }],
    ["blank message", { message: "   ", page: "/x" }],
    ["message over 1,000 characters", { message: "a".repeat(1001), page: "/x" }],
    ["missing page", { message: "hello" }],
    ["page that is not a path", { message: "hello", page: "requests" }],
    ["page over 200 characters", { message: "hello", page: "/" + "a".repeat(200) }],
    ["an extra field", { message: "hello", page: "/x", categoryId: "x" }],
    ["a userId", { message: "hello", page: "/x", userId: "abc" }],
  ])("returns 422 for %s, calls nothing and records nothing", async (_n, body) => {
    expect((await call(body)).status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.chatDraft.count()).toBe(0);
  });

  it("accepts exactly 1,000 characters", async () => {
    fetchMock.mockResolvedValue(reply(200, aiOk()));
    expect((await call({ message: "a".repeat(1000), page: "/x" })).status).toBe(200);
  });
});

const unreachable = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });

describe("POST /requests/chat-draft: every failure is a 503 and a record with its cause", () => {
  const cases: [string, () => void, string, string, string, string?][] = [
    // [name, arrange, errorCode, outcome, expected reason fragment, expected detail fragment]
    ["service down", () => fetchMock.mockRejectedValue(unreachable()), "AI_UNREACHABLE", "UNAVAILABLE", "connection refused", "ECONNREFUSED"],
    ["host not found", () => fetchMock.mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } })), "AI_UNREACHABLE", "UNAVAILABLE", "host not found"],
    ["no answer in time", () => fetchMock.mockRejectedValue(new DOMException("slow", "TimeoutError")), "AI_TIMEOUT", "TIMEOUT", "timed out after 25s"],
    ["token rejected", () => fetchMock.mockResolvedValue(aiFails(401, "UNAUTHORIZED")), "AI_AUTH", "UNAVAILABLE", "AI service returned 401"],
    ["Groq rate limit", () => fetchMock.mockResolvedValue(aiFails(429, "RATE_LIMITED")), "AI_RATE_LIMITED", "UNAVAILABLE", "429 (rate limited)", "drafter.py"],
    ["AI service timed out", () => fetchMock.mockResolvedValue(aiFails(504, "TIMEOUT")), "AI_TIMEOUT", "TIMEOUT", "504"],
    ["model error", () => fetchMock.mockResolvedValue(aiFails(502, "MODEL_ERROR")), "AI_MODEL_ERROR", "UNAVAILABLE", "MODEL_ERROR"],
    ["no model key", () => fetchMock.mockResolvedValue(aiFails(502, "MODEL_NOT_CONFIGURED")), "AI_MODEL_ERROR", "UNAVAILABLE", "MODEL_NOT_CONFIGURED"],
    ["unexpected 500", () => fetchMock.mockResolvedValue(aiFails(500, "INTERNAL")), "AI_MODEL_ERROR", "UNAVAILABLE", "500"],
    ["invalid output twice", () => fetchMock.mockResolvedValue(aiFails(502, "INVALID_OUTPUT")), "AI_INVALID_OUTPUT", "INVALID_OUTPUT", "invalid output after retry"],
    ["our body rejected", () => fetchMock.mockResolvedValue(aiFails(422, "VALIDATION_FAILED", "body.message: string_too_long")), "AI_BAD_RESPONSE", "INVALID_OUTPUT", "422", "string_too_long"],
    ["answer not JSON", () => fetchMock.mockResolvedValue(new Response("<html>oops</html>", { status: 200 })), "AI_BAD_RESPONSE", "INVALID_OUTPUT", "unexpected shape"],
    ["answer missing fields", () => fetchMock.mockResolvedValue(reply(200, { title: "x" })), "AI_BAD_RESPONSE", "INVALID_OUTPUT", "unexpected shape", "description"],
    ["priority outside the enum", () => fetchMock.mockResolvedValue(reply(200, aiOk({ priority: "CRITICAL" }))), "AI_BAD_RESPONSE", "INVALID_OUTPUT", "unexpected shape", "priority"],
    ["unknown category code", () => fetchMock.mockResolvedValue(reply(200, aiOk({ category: "LAPTOPS" }))), "AI_REJECTED_BY_BACKEND", "INVALID_OUTPUT", "category code was not one we offered", 'category code "LAPTOPS" is not allowed'],
    ["unknown department code", () => fetchMock.mockResolvedValue(reply(200, aiOk({ department: "NOPE" }))), "AI_REJECTED_BY_BACKEND", "INVALID_OUTPUT", "department code was not one we offered", 'department code "NOPE" is not allowed'],
  ];

  it.each(cases)("%s", async (_name, arrange, errorCode, outcome, reason, detail) => {
    arrange();
    const res = await call({ message: SECRET, page: "/requests" });
    const body = await json(res);
    expect(res.status).toBe(503);
    expect(body.error.code).toBe("AI_UNAVAILABLE");
    expect(body.error.message).toContain("fill in the form yourself");
    const [row] = await rows();
    expect(row).toMatchObject({ userId, outcome, errorCode, categoryId: null, departmentId: null, priority: null, messageChars: SECRET.length });
    expect(row.error).toContain(reason);
    if (detail) expect(row.errorDetail).toContain(detail);
    expect(body.error.details.requestId).toBe(row.requestId);
    // the message never reaches the record or the response
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("stores the AI service's redacted trace, trimmed to 4,000 characters", async () => {
    fetchMock.mockResolvedValue(aiFails(502, "MODEL_ERROR", "x".repeat(9000)));
    await call(ok);
    const [row] = await rows();
    expect(row.errorDetail!.length).toBeLessThanOrEqual(4000);
  });

  it("does not store a rejected code that looks like echoed text", async () => {
    fetchMock.mockResolvedValue(reply(200, aiOk({ category: `my laptop is on fire ${SECRET}` })));
    await call({ message: SECRET, page: "/requests" });
    const [row] = await rows();
    expect(row.errorCode).toBe("AI_REJECTED_BY_BACKEND");
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(row.errorDetail).toContain("(not a usable code)");
  });

  it("is a 503 with a record when the service URL or token is not configured", async () => {
    delete process.env.AI_SERVICE_TOKEN;
    const res = await call(ok);
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await rows())[0]).toMatchObject({ errorCode: "AI_UNREACHABLE", outcome: "UNAVAILABLE" });
  });

  it("creates no service request on any failure", async () => {
    fetchMock.mockRejectedValue(unreachable());
    const before = await db.serviceRequest.count();
    await call(ok);
    expect(await db.serviceRequest.count()).toBe(before);
  });
});

describe("the record never blocks the draft", () => {
  it("still returns the draft when the record cannot be written", async () => {
    fetchMock.mockResolvedValue(reply(200, aiOk()));
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((c: string | Uint8Array) => (written.push(String(c)), true)) as never);
    const spy = vi.spyOn(prisma.chatDraft, "create").mockRejectedValue(new Error("db down for " + SECRET));
    const res = await call({ ...ok, message: SECRET });
    expect(spy).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect((await json(res)).title).toBe("Laptop overheating");
    // The failure is logged as one line that names the request, and carries neither the message text nor the error's own text.
    const lines = written.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const failed = lines.filter((l) => l.event === "chat_drafts.write_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ level: "error", errorName: "Error", requestId: res.headers.get("x-request-id") });
    expect(written.join("")).not.toContain(SECRET);
  });

  it("still answers 503 (not 500) when the record cannot be written on a failure", async () => {
    fetchMock.mockRejectedValue(unreachable());
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(prisma.chatDraft, "create").mockRejectedValue(new Error("db down"));
    expect((await call(ok)).status).toBe(503);
  });
});

describe("chat_drafts table", () => {
  it("has the unique request id, the two list indexes and row-level security without policies", async () => {
    const idx = (await db.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE tablename = 'chat_drafts'`)) as { indexname: string }[];
    expect(idx.map((i) => i.indexname).sort()).toEqual([
      "chat_drafts_created_at_idx", "chat_drafts_pkey", "chat_drafts_request_id_key", "chat_drafts_user_id_created_at_idx",
    ]);
    const [rls] = (await db.$queryRawUnsafe(`SELECT relrowsecurity FROM pg_class WHERE relname = 'chat_drafts'`)) as { relrowsecurity: boolean }[];
    expect(rls.relrowsecurity).toBe(true);
    const policies = (await db.$queryRawUnsafe(`SELECT 1 FROM pg_policies WHERE tablename = 'chat_drafts'`)) as unknown[];
    expect(policies).toHaveLength(0);
  });

  it("refuses a success with an error code, a failure without one, and out-of-range numbers", async () => {
    const base = { userId, page: "/x", requestId: crypto.randomUUID(), messageChars: 1 };
    const create = (data: object) => db.chatDraft.create({ data: { ...base, requestId: crypto.randomUUID(), ...data } as never });
    await expect(create({ outcome: "OK", errorCode: "AI_TIMEOUT" })).rejects.toThrow();
    await expect(create({ outcome: "TIMEOUT" })).rejects.toThrow();
    await expect(create({ outcome: "OK", confidence: 1.5 })).rejects.toThrow();
    await expect(create({ outcome: "OK", attempts: 3 })).rejects.toThrow();
    await expect(create({ outcome: "OK", messageChars: -1 })).rejects.toThrow();
    await expect(create({ outcome: "TIMEOUT", errorCode: "AI_TIMEOUT", errorDetail: "x".repeat(4001) })).rejects.toThrow();
    await expect(create({ outcome: "OK" })).resolves.toBeTruthy();
  });

  it("is cleared when the seed clears the database", async () => {
    await db.chatDraft.create({ data: { userId, page: "/x", requestId: crypto.randomUUID(), messageChars: 1, outcome: "OK" } });
    await clearAll(db);
    expect(await db.chatDraft.count()).toBe(0);
    ids = await seedBase(db, await bcrypt.hash("x", 4));
    userId = ids.personas.newHire;
  });
});
