import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as teamRoute } from "../app/api/v1/dashboard/team/route";
import { clearAll, seedBase } from "../prisma/seed/base";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import type { AuthUser } from "@/lib/auth";
import { addDays, todayInDhaka } from "@/services/onboarding-logic";
import { getTeamDashboard } from "@/services/team-dashboard";
import { db } from "./db";

let base: Awaited<ReturnType<typeof seedBase>>;
let otherManager: string; // a Manager with a team of their own, not the persona's
let lonelyManager: string; // a Manager with nobody reporting to them
const today = () => todayInDhaka();

beforeAll(async () => {
  await clearAll(db);
  base = await seedBase(db, await bcrypt.hash("x", 4));
  const managers = await db.user.findMany({ where: { role: { code: "MANAGER" }, id: { not: base.personas.manager } }, include: { _count: { select: { reports: true } } } });
  otherManager = managers.find((m) => m._count.reports > 0)!.id;
  // Nobody reports to this person: take a Manager's profile and make a new one.
  const template = await db.user.findUniqueOrThrow({ where: { id: base.personas.manager } });
  lonelyManager = (
    await db.user.create({
      data: {
        employeeCode: "EMP-9001", fullName: "Lonely Manager", email: "lonely.manager@hris.test", passwordHash: "x",
        roleId: template.roleId, countryId: template.countryId, departmentId: template.departmentId, managerId: null,
        jobTitle: "Manager", joiningDate: new Date("2020-01-01"), statusId: template.statusId,
      },
    })
  ).id;
});
afterAll(() => db.$disconnect());

const call = async (userId: string | null, qs = "") =>
  teamRoute(
    new Request(`http://x/api/v1/dashboard/team${qs}`, { headers: userId ? { cookie: `${SESSION_COOKIE}=${await signSession(userId)}` } : {} }),
  );
const get = async (userId: string, qs = "") => (await call(userId, qs)).json() as Promise<any>;

describe("GET /dashboard/team: who may call it", () => {
  it("is for Managers only", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call(base.personas.hrAdmin)).status).toBe(403);
    expect((await call(base.personas.newHire)).status).toBe(403);
    expect((await call(base.personas.itSupport)).status).toBe(403);
    expect((await call(base.personas.manager)).status).toBe(200);
  });
});

describe("GET /dashboard/team: period", () => {
  it("defaults to 30 days and accepts 7, 30 and 90", async () => {
    expect(await get(base.personas.manager)).toMatchObject({ periodDays: 30, asOf: today(), periodStart: addDays(today(), -29) });
    for (const days of [7, 30, 90]) {
      expect(await get(base.personas.manager, `?days=${days}`)).toMatchObject({ periodDays: days, periodStart: addDays(today(), -(days - 1)) });
    }
  });

  it("refuses any other value with a 422 naming days", async () => {
    for (const bad of ["14", "0", "-7", "abc", "7.5", "30days", "%2030"]) {
      const res = await call(base.personas.manager, `?days=${bad}`);
      expect(res.status, bad).toBe(422);
      expect((await res.json() as any).error.details[0].path).toBe("days");
    }
  });

  it("treats an empty days as absent", async () => {
    expect(await get(base.personas.manager, "?days=")).toMatchObject({ periodDays: 30 });
  });
});

describe("GET /dashboard/team: the team", () => {
  it("is the manager's direct reports, in name order, and nobody else", async () => {
    const body = await get(base.personas.manager);
    const expected = await db.user.findMany({ where: { managerId: base.personas.manager }, orderBy: { fullName: "asc" } });
    expect(expected.length).toBeGreaterThan(1);
    expect(body.teamSize).toBe(expected.length);
    expect(body.people.map((p: any) => p.id)).toEqual(expected.map((u) => u.id));
    expect(body.people.map((p: any) => p.fullName)).toEqual(expected.map((u) => u.fullName));
    // Not the manager, not another manager's people.
    expect(body.people.map((p: any) => p.id)).not.toContain(base.personas.manager);
    const others = await db.user.findMany({ where: { managerId: otherManager }, select: { id: true } });
    expect(others.length).toBeGreaterThan(0);
    for (const o of others) expect(body.people.map((p: any) => p.id)).not.toContain(o.id);
  });

  it("shows another manager their own team, not this one's", async () => {
    const body = await get(otherManager);
    const mine = await db.user.findMany({ where: { managerId: otherManager }, select: { id: true } });
    expect(body.people.map((p: any) => p.id).sort()).toEqual(mine.map((u) => u.id).sort());
  });

  it("includes people of every status, such as On notice", async () => {
    const report = (await db.user.findMany({ where: { managerId: base.personas.manager }, orderBy: { fullName: "asc" } }))[0];
    const notice = await db.userStatus.findUniqueOrThrow({ where: { code: "ON_NOTICE" } });
    const before = report.statusId;
    await db.user.update({ where: { id: report.id }, data: { statusId: notice.id } });
    try {
      expect((await get(base.personas.manager)).people.map((p: any) => p.id)).toContain(report.id);
    } finally {
      await db.user.update({ where: { id: report.id }, data: { statusId: before } });
    }
  });

  it("gives each person a row with a name, a job title and the documented counts", async () => {
    const body = await get(base.personas.manager);
    for (const p of body.people) {
      expect(Object.keys(p).sort()).toEqual([
        "fullName", "id", "jobTitle", "openRequests", "openTasks", "overdueTasks", "resolvedInPeriod", "tasksCompletedLate", "tasksCompletedOnTime",
      ]);
      expect(p.fullName).toEqual(expect.any(String));
      expect(p.jobTitle).toEqual(expect.any(String));
    }
  });

  it("returns an empty team, not an error, for a manager with no direct reports", async () => {
    const res = await call(lonelyManager);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ teamSize: 0, people: [] });
  });

  it("has the documented top-level fields", async () => {
    expect(Object.keys(await get(base.personas.manager)).sort()).toEqual(["asOf", "newHires", "people", "periodDays", "periodStart", "requests", "tasks", "teamSize"]);
  });
});

// ═════════════════════════════════ Task 43: requests ═══════════════════════════════

describe("team dashboard: requests", () => {
  // A fixed "today" so every expected number can be worked out by hand. Dhaka is UTC+6, so with days=30 the period is
  // 2026-05-17 .. 2026-06-15 and runs from 2026-05-16T18:00:00Z up to (not including) 2026-06-15T18:00:00Z.
  const TODAY = "2026-06-15";
  const at = (iso: string) => new Date(iso);
  let A: string, B: string; // two direct reports of the persona manager
  let outsider: string; // a direct report of another manager
  let requester: string;
  let categoryId: string, departmentId: string;
  const manager = () => ({ id: base.personas.manager }) as AuthUser;
  const dash = (days: 7 | 30 | 90 = 30, who = manager()) => getTeamDashboard(who, days, TODAY);
  const row = (d: Awaited<ReturnType<typeof dash>>, id: string) => d.people.find((p) => p.id === id)!;

  /** A request with its events. `resolvedAt` adds the RESOLVED event; `closedAt` a later CLOSED one; `history` earlier assignment events. */
  async function request(o: { assignee: string | null; status: "SUBMITTED" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED"; created: string; resolvedAt?: string; closedAt?: string; earlierAssignee?: string }) {
    const r = await db.serviceRequest.create({
      data: { requesterId: requester, categoryId, handlingDepartmentId: departmentId, assigneeId: o.assignee, title: "t", description: "d", priority: "MEDIUM", status: o.status, createdAt: at(o.created) },
    });
    const event = (toStatus: string, when: string, assigneeId: string | null = null) =>
      db.requestEvent.create({ data: { requestId: r.id, toStatus: toStatus as any, actorId: requester, assigneeId, createdAt: at(when) } });
    if (o.earlierAssignee) await event("ASSIGNED", o.created, o.earlierAssignee);
    if (o.resolvedAt) await event("RESOLVED", o.resolvedAt, o.assignee);
    if (o.closedAt) await event("CLOSED", o.closedAt);
    return r;
  }

  beforeAll(async () => {
    const reports = await db.user.findMany({ where: { managerId: base.personas.manager }, orderBy: { fullName: "asc" } });
    [A, B] = [reports[0].id, reports[1].id];
    outsider = (await db.user.findFirstOrThrow({ where: { managerId: otherManager } })).id;
    requester = base.personas.newHire;
    const cat = await db.requestCategory.findFirstOrThrow();
    [categoryId, departmentId] = [cat.id, cat.handlingDepartmentId];
    await db.requestEvent.deleteMany();
    await db.serviceRequest.deleteMany();

    // ── A: two open (one very old), a SUBMITTED row that is not open work, and five resolved in the 30-day period ──
    await request({ assignee: A, status: "ASSIGNED", created: "2025-01-01T00:00:00Z" });
    await request({ assignee: A, status: "IN_PROGRESS", created: "2026-06-14T00:00:00Z" });
    await request({ assignee: A, status: "SUBMITTED", created: "2026-06-14T00:00:00Z" });
    await request({ assignee: A, status: "RESOLVED", created: "2026-06-01T00:00:00Z", resolvedAt: "2026-06-03T12:00:00Z" }); //  60 h
    await request({ assignee: A, status: "RESOLVED", created: "2026-06-10T00:00:00Z", resolvedAt: "2026-06-10T06:00:00Z" }); //   6 h
    await request({ assignee: A, status: "RESOLVED", created: "2026-05-10T00:00:00Z", resolvedAt: "2026-05-16T18:00:00Z" }); // 162 h, the first instant of the period
    await request({ assignee: A, status: "RESOLVED", created: "2026-06-15T05:59:59Z", resolvedAt: "2026-06-15T17:59:59Z" }); //  12 h, the last second of today
    await request({ assignee: A, status: "CLOSED", created: "2026-06-12T00:00:00Z", resolvedAt: "2026-06-13T00:00:00Z", closedAt: "2026-06-20T00:00:00Z" }); // 24 h; closing later changes nothing
    // Resolved just outside the period on either side: never counted.
    await request({ assignee: A, status: "RESOLVED", created: "2026-05-10T00:00:00Z", resolvedAt: "2026-05-16T17:59:59Z" });
    await request({ assignee: A, status: "RESOLVED", created: "2026-06-10T00:00:00Z", resolvedAt: "2026-06-15T18:00:00Z" });
    // ── B: one open, and one resolved after being reassigned from A (it counts for B only) ──
    await request({ assignee: B, status: "IN_PROGRESS", created: "2026-06-01T00:00:00Z" });
    await request({ assignee: B, status: "RESOLVED", created: "2026-06-14T00:00:00Z", resolvedAt: "2026-06-14T06:00:00Z", earlierAssignee: A }); // 6 h
    // ── not the team: another manager's report, the manager themself, and nobody ──
    await request({ assignee: outsider, status: "IN_PROGRESS", created: "2026-06-01T00:00:00Z" });
    await request({ assignee: outsider, status: "RESOLVED", created: "2026-06-10T00:00:00Z", resolvedAt: "2026-06-11T00:00:00Z" });
    await request({ assignee: base.personas.manager, status: "ASSIGNED", created: "2026-06-01T00:00:00Z" });
    await request({ assignee: base.personas.manager, status: "RESOLVED", created: "2026-06-10T00:00:00Z", resolvedAt: "2026-06-11T00:00:00Z" });
    await request({ assignee: null, status: "SUBMITTED", created: "2026-06-10T00:00:00Z" });
  });

  it("counts open work as Assigned or In Progress only, whatever its age", async () => {
    const d = await dash();
    expect(row(d, A).openRequests).toBe(2);
    expect(row(d, B).openRequests).toBe(1);
    expect(d.requests.open).toBe(3);
  });

  it("counts requests resolved inside the period, edges included, and ignores a later close", async () => {
    const d = await dash();
    expect(row(d, A).resolvedInPeriod).toBe(5); // 60h, 6h, 162h (first instant), 12h (last second), 24h (closed later)
    expect(row(d, B).resolvedInPeriod).toBe(1);
    expect(d.requests.resolvedInPeriod).toBe(6);
  });

  it("averages submitted-to-resolved time in hours: (60 + 6 + 162 + 12 + 24 + 6) / 6 = 45", async () => {
    expect((await dash()).requests.avgHoursToResolve).toBe(45);
  });

  it("follows the period: 7 days keeps only the last week's resolutions (6 + 12 + 24 + 6) / 4 = 12", async () => {
    const d = await dash(7);
    expect(d.requests.resolvedInPeriod).toBe(4);
    expect(row(d, A).resolvedInPeriod).toBe(3);
    expect(d.requests.avgHoursToResolve).toBe(12);
    expect(d.requests.open).toBe(3); // open work is a current count and does not depend on the period
  });

  it("counts a reassigned request for whoever holds it now, not who had it first", async () => {
    const d = await dash();
    expect(row(d, B).resolvedInPeriod).toBe(1);
    expect(row(d, A).resolvedInPeriod).toBe(5);
  });

  it("never counts another manager's report, the manager's own work, or unassigned requests", async () => {
    const d = await dash();
    expect(d.requests.open).toBe(3);
    expect(d.requests.resolvedInPeriod).toBe(6);
    const other = await dash(30, { id: otherManager } as AuthUser);
    expect(other.requests).toMatchObject({ open: 1, resolvedInPeriod: 1, avgHoursToResolve: 24 });
  });

  it("has no average when nothing was resolved", async () => {
    expect((await dash(30, { id: lonelyManager } as AuthUser)).requests).toEqual({ open: 0, resolvedInPeriod: 0, avgHoursToResolve: null });
    const noneYet = await getTeamDashboard(manager(), 7, "2026-04-01"); // before anything in the fixture was resolved
    expect(noneYet.requests).toMatchObject({ resolvedInPeriod: 0, avgHoursToResolve: null });
  });

  it("keeps the totals equal to the sum of the people rows", async () => {
    const d = await dash();
    expect(d.people.reduce((n, p) => n + p.openRequests, 0)).toBe(d.requests.open);
    expect(d.people.reduce((n, p) => n + p.resolvedInPeriod, 0)).toBe(d.requests.resolvedInPeriod);
  });

  it("is what the route returns too, for the persona manager", async () => {
    const body = await get(base.personas.manager);
    expect(body.requests.open).toBe(3); // open work does not depend on the real date
  });
});
