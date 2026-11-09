import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as teamRoute } from "../app/api/v1/dashboard/team/route";
import { clearAll, seedBase } from "../prisma/seed/base";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { addDays, todayInDhaka } from "@/services/onboarding-logic";
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

  it("gives each person a row with a name, a job title and every count at zero for now", async () => {
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
