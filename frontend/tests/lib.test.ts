import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, api } from "@/lib/api";
import { activeHref, homeForRole, navForRole } from "@/lib/nav";

afterEach(() => vi.unstubAllGlobals());

const stubFetch = (status: number, body?: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })));

describe("navForRole", () => {
  it("shows the dashboard to HR Admin only", () => {
    expect(navForRole("HR_ADMIN").map((i) => i.href)).toContain("/dashboard");
    expect(navForRole("MANAGER").map((i) => i.href)).not.toContain("/dashboard");
    expect(navForRole("EMPLOYEE").map((i) => i.href)).not.toContain("/dashboard");
  });
  it("shows requests to everyone", () => {
    for (const r of ["EMPLOYEE", "MANAGER", "HR_ADMIN"] as const) {
      expect(navForRole(r).map((i) => i.href)).toContain("/requests");
    }
  });
  it("lands HR on the dashboard and others on requests", () => {
    expect(homeForRole("HR_ADMIN")).toBe("/dashboard");
    expect(homeForRole("EMPLOYEE")).toBe("/requests");
  });
});

describe("api client", () => {
  it("returns parsed JSON and prefixes /api/v1", async () => {
    stubFetch(200, { ok: 1 });
    expect(await api("/x")).toEqual({ ok: 1 });
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/v1/x");
  });
  it("returns undefined for 204", async () => {
    stubFetch(204);
    expect(await api("/auth/logout", { method: "POST" })).toBeUndefined();
  });
  it("keeps the request id from the error envelope, so a user can quote it when reporting a problem", async () => {
    stubFetch(500, { error: { code: "INTERNAL", message: "Internal server error", requestId: "7c1e5a52-0000-4000-8000-000000000001" } });
    await expect(api("/x")).rejects.toMatchObject({ status: 500, requestId: "7c1e5a52-0000-4000-8000-000000000001" });
    stubFetch(404, { error: { code: "NOT_FOUND", message: "gone" } });
    expect(((await api("/x").catch((e) => e)) as ApiClientError).requestId).toBeUndefined();
  });

  it("throws ApiClientError carrying the backend error envelope", async () => {
    stubFetch(422, { error: { code: "VALIDATION_FAILED", message: "bad", details: [1] } });
    await expect(api("/x")).rejects.toMatchObject({ status: 422, code: "VALIDATION_FAILED", message: "bad", details: [1] });
  });
  it("falls back to a generic error when the body is not JSON", async () => {
    stubFetch(502);
    const err = await api("/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 502, code: "UNKNOWN" });
  });
});

import { formatDate, labelize } from "@/lib/format";
import { buildQuery } from "@/lib/query";

describe("navForRole: people", () => {
  it("shows People to Managers and HR Admins only", () => {
    expect(navForRole("EMPLOYEE").map((i) => i.href)).not.toContain("/people");
    expect(navForRole("MANAGER").map((i) => i.href)).toContain("/people");
    expect(navForRole("HR_ADMIN").map((i) => i.href)).toContain("/people");
  });
});

describe("buildQuery", () => {
  it("skips empty values and encodes the rest", () => {
    expect(buildQuery({ search: "ana b", country: "", page: 2, x: undefined })).toBe("?search=ana+b&page=2");
    expect(buildQuery({})).toBe("");
  });
});

describe("format", () => {
  it("labelizes enum values", () => {
    expect(labelize("SRI_LANKA")).toBe("Sri Lanka");
    expect(labelize("ON_PROBATION", { title: false })).toBe("On probation");
  });
  it("formats dates in UTC so they never shift", () => {
    expect(formatDate("2026-11-02")).toBe("2 Nov 2026");
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
  });
});

describe("navForRole: onboarding", () => {
  const hrefs = (r: Parameters<typeof navForRole>[0], isNewHire = false) => navForRole(r, { isNewHire }).map((i) => i.href);

  it("shows the task queue to everyone", () => {
    for (const r of ["EMPLOYEE", "MANAGER", "HR_ADMIN"] as const) expect(hrefs(r)).toContain("/onboarding/tasks");
  });
  it("shows the progress overview to Managers and HR Admins only", () => {
    expect(hrefs("EMPLOYEE")).not.toContain("/onboarding");
    expect(hrefs("MANAGER")).toContain("/onboarding");
    expect(hrefs("HR_ADMIN")).toContain("/onboarding");
  });
  it("shows templates to HR Admins only", () => {
    expect(hrefs("MANAGER")).not.toContain("/onboarding/templates");
    expect(hrefs("HR_ADMIN")).toContain("/onboarding/templates");
  });
  it("shows My onboarding only to people with an active checklist", () => {
    expect(hrefs("EMPLOYEE")).not.toContain("/onboarding/me");
    expect(hrefs("EMPLOYEE", true)).toContain("/onboarding/me");
    expect(hrefs("MANAGER", true)).toContain("/onboarding/me");
  });
});

describe("activeHref", () => {
  const items = navForRole("HR_ADMIN", { isNewHire: true });
  it("lights only the most specific nav item", () => {
    expect(activeHref(items, "/onboarding")).toBe("/onboarding");
    expect(activeHref(items, "/onboarding/instances/abc")).toBe("/onboarding");
    expect(activeHref(items, "/onboarding/tasks")).toBe("/onboarding/tasks");
    expect(activeHref(items, "/onboarding/templates/new")).toBe("/onboarding/templates");
    expect(activeHref(items, "/onboarding/me")).toBe("/onboarding/me");
    expect(activeHref(items, "/requests/123")).toBe("/requests");
  });
  it("lights nothing on an unrelated path", () => {
    expect(activeHref(items, "/elsewhere")).toBeUndefined();
  });
  it("does not match on a shared prefix that isn't a path segment", () => {
    expect(activeHref(items, "/onboardingx")).toBeUndefined();
  });
});

import { categoryChartData, openRequests, totalPeople, type DashboardSummary } from "@/lib/dashboard";

describe("dashboard helpers", () => {
  const summary = {
    headcountByCountry: [{ country: "BANGLADESH", count: 40 }, { country: "CYPRUS", count: 15 }],
    requestsByStatus: [
      { status: "SUBMITTED", count: 7 }, { status: "ASSIGNED", count: 7 }, { status: "IN_PROGRESS", count: 8 },
      { status: "RESOLVED", count: 6 }, { status: "CLOSED", count: 7 },
    ],
    requestsByCategory: [
      { category: { id: "1", code: "IT_EQUIPMENT", name: "IT Equipment" }, count: 9, open: 5 },
      { category: { id: "2", code: "OTHER", name: "Other" }, count: 0, open: 0 },
    ],
  } as unknown as DashboardSummary;

  it("totals people across countries", () => expect(totalPeople(summary)).toBe(55));
  it("counts only unresolved requests as open", () => expect(openRequests(summary)).toBe(22));
  it("splits each category into open and finished so the stack equals the total", () => {
    expect(categoryChartData(summary)).toEqual([
      { name: "IT Equipment", open: 5, finished: 4 },
      { name: "Other", open: 0, finished: 0 },
    ]);
  });
});

import { prefersReducedMotion } from "@/lib/hooks/use-reduced-motion";

describe("prefersReducedMotion", () => {
  const win = (matches: boolean) => ({ matchMedia: (q: string) => ({ matches: q.includes("reduce") && matches }) });
  it("is true only when the system asks for reduced motion", () => {
    expect(prefersReducedMotion(win(true))).toBe(true);
    expect(prefersReducedMotion(win(false))).toBe(false);
  });
  it("defaults to motion allowed where matchMedia is unavailable", () => {
    expect(prefersReducedMotion(undefined)).toBe(false);
    expect(prefersReducedMotion({})).toBe(false);
  });
});
