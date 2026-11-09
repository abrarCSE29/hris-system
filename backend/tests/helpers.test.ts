import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, errorResponse, toErrorResponse } from "@/lib/errors";
import { parse, readJson } from "@/lib/validation";
import { paginated, parsePaging } from "@/lib/pagination";
import { GET as health } from "../app/api/v1/health/route";

describe("health", () => {
  it("returns ok", async () => {
    const res = await health(new Request("http://x/api/v1/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("errors", () => {
  it.each([
    ["UNAUTHORIZED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["INVALID_TRANSITION", 409],
    ["VALIDATION_FAILED", 422],
  ] as const)("%s maps to %i with the spec envelope", async (code, status) => {
    const res = errorResponse(new ApiError(code, "msg"));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: { code, message: "msg" } });
  });

  it("hides unknown errors behind a generic 500", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const res = toErrorResponse(new Error("db password leaked"));
    write.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("leaked");
  });
});

describe("validation", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("returns parsed data", () => {
    expect(parse(schema, { name: "a" })).toEqual({ name: "a" });
  });

  it("throws a 422 ApiError with field paths", () => {
    try {
      parse(schema, { name: "" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(422);
      expect((e as ApiError).details).toEqual([expect.objectContaining({ path: "name" })]);
    }
  });

  it("treats malformed JSON as 422", async () => {
    const req = new Request("http://x", { method: "POST", body: "{nope" });
    await expect(readJson(req)).rejects.toMatchObject({ status: 422 });
  });
});

describe("pagination", () => {
  it("defaults to page 1, size 20", () => {
    expect(parsePaging(new URLSearchParams())).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
  });

  it("computes skip and falls back on garbage input", () => {
    expect(parsePaging(new URLSearchParams("page=3&pageSize=10")).skip).toBe(20);
    expect(parsePaging(new URLSearchParams("page=abc&pageSize=9999"))).toMatchObject({ page: 1, pageSize: 20 });
  });

  it("builds the list envelope", () => {
    const p = parsePaging(new URLSearchParams());
    expect(paginated([1], 41, p)).toEqual({ data: [1], page: 1, pageSize: 20, total: 41 });
  });
});
