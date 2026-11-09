import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log, redact } from "@/lib/logger";

let lines: string[];
beforeEach(() => {
  lines = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as never);
  delete process.env.LOG_LEVEL;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LOG_LEVEL;
});

const entries = () => lines.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l));

describe("log", () => {
  it("writes one JSON object per line to stdout, with time, level and event", () => {
    log("info", "http.request", { requestId: "r1", status: 200 });
    log("warn", "auth.login_failed", { requestId: "r2" });
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.endsWith("\n") && !l.slice(0, -1).includes("\n"))).toBe(true);
    const [a, b] = entries();
    expect(a).toMatchObject({ level: "info", event: "http.request", requestId: "r1", status: 200 });
    expect(new Date(a.ts).toISOString()).toBe(a.ts);
    expect(b).toMatchObject({ level: "warn", event: "auth.login_failed" });
  });

  it("does not let a field overwrite ts, level or event", () => {
    log("info", "real.event", { ts: "fake", level: "debug", event: "fake.event", other: 1 });
    const [e] = entries();
    expect(e.event).toBe("real.event");
    expect(e.level).toBe("info");
    expect(e.ts).not.toBe("fake");
    expect(e).toMatchObject({ field_ts: "fake", field_level: "debug", field_event: "fake.event", other: 1 });
  });

  it("skips lines below LOG_LEVEL (default info)", () => {
    log("debug", "a");
    expect(lines).toHaveLength(0);
    process.env.LOG_LEVEL = "debug";
    log("debug", "b");
    expect(entries().map((e) => e.event)).toEqual(["b"]);
    lines.length = 0;
    process.env.LOG_LEVEL = "error";
    log("info", "c");
    log("warn", "d");
    log("error", "e");
    expect(entries().map((e) => e.event)).toEqual(["e"]);
  });

  it("falls back to info for an unknown LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "loud";
    log("debug", "x");
    log("info", "y");
    expect(entries().map((e) => e.event)).toEqual(["y"]);
  });

  it("does not throw on a circular field or a BigInt, and still writes a line", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => log("info", "circular", { loop })).not.toThrow();
    expect(() => log("info", "big", { n: BigInt(5) })).not.toThrow();
    const out = entries();
    expect(out.map((e) => e.event)).toEqual(["circular", "big"]);
  });

  it("does not throw when writing to stdout fails", () => {
    vi.mocked(process.stdout.write).mockImplementation(() => {
      throw new Error("closed");
    });
    expect(() => log("error", "x")).not.toThrow();
  });
});

describe("redact", () => {
  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcDEF123_-xyz";
  const HASH = "$2b$10$" + "a".repeat(53);

  it.each([
    ["a JWT", `bad token ${JWT} here`, JWT],
    ["a bearer value", "Authorization: Bearer abc.def-123", "abc.def-123"],
    ["a key in a query string", "GET https://x.test/?key=SECRET123&a=1", "SECRET123"],
    ["a token in a query string", "https://x.test/?access_token=TOK999", "TOK999"],
    ["a password in JSON", 'body {"password":"hunter2hunter2"}', "hunter2hunter2"],
    ["an email address", "no user ana.perera@hris.test found", "ana.perera@hris.test"],
    ["a bcrypt hash", `hash ${HASH} stored`, HASH],
    ["a Groq-style key", "invalid key gsk_abcdefghijklmnopqrstuvwxyz0123", "gsk_abcdefghijklmnopqrstuvwxyz0123"],
  ])("removes %s", (_name, input, secret) => {
    const out = redact(input);
    expect(out).not.toContain(secret);
    expect(out.length).toBeGreaterThan(0);
  });

  it("keeps the rest of the message readable", () => {
    expect(redact("Foreign key constraint failed on user ana@x.test in table users")).toBe(
      "Foreign key constraint failed on user [email] in table users",
    );
    expect(redact("plain message")).toBe("plain message");
  });

  it("cuts long text at the limit and says so", () => {
    const out = redact("x".repeat(5000), 100);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).toContain("[truncated]");
    expect(redact("short", 100)).toBe("short");
  });

  it("redacts before cutting, so a secret split by the limit is not left half-shown", () => {
    const out = redact(`${"x".repeat(90)} key=SECRETSECRETSECRET`, 100);
    expect(out).not.toMatch(/SECRET/);
  });

  it("handles empty and non-string input without throwing", () => {
    expect(redact("")).toBe("");
    expect(redact(undefined as unknown as string)).toBe("");
  });
});
