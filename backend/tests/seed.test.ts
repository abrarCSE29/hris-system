import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearAll, seedBase } from "../prisma/seed/base";
import { PERSONA_EMAILS } from "../prisma/seed/data";
import { db } from "./db";

let base: Awaited<ReturnType<typeof seedBase>>;
const group = async (field: "country" | "role" | "status") =>
  Object.fromEntries((await db.user.groupBy({ by: [field], _count: true })).map((g) => [g[field], g._count]));

beforeAll(async () => {
  await clearAll(db);
  base = await seedBase(db, await bcrypt.hash("x", 4));
});
afterAll(() => db.$disconnect());

describe("base seed", () => {
  it("creates 7 departments and 100 users with the required country split", async () => {
    expect(await db.department.count()).toBe(7);
    expect(await group("country")).toEqual({ BANGLADESH: 40, MALAYSIA: 25, SRI_LANKA: 20, CYPRUS: 15 });
  });

  it("has 3 HR admins, 12 managers and 85 employees", async () => {
    expect(await group("role")).toEqual({ HR_ADMIN: 3, MANAGER: 12, EMPLOYEE: 85 });
  });

  it("has ~10 on probation and 4 on notice, the rest active", async () => {
    expect(await group("status")).toEqual({ ACTIVE: 86, ON_PROBATION: 10, ON_NOTICE: 4 });
  });

  it("gives every department a head who is a Manager in that department", async () => {
    const depts = await db.department.findMany({ include: { head: true } });
    for (const d of depts) {
      expect(d.head?.role).toBe("MANAGER");
      expect(d.head?.departmentId).toBe(d.id);
    }
  });

  it("routes categories to the right departments", async () => {
    const cats = await db.requestCategory.findMany({ include: { handlingDepartment: true } });
    const by = Object.fromEntries(cats.map((c) => [c.code, c.handlingDepartment.code]));
    expect(by).toEqual({ IT_EQUIPMENT: "ITOPS", SOFTWARE_ACCESS: "ITOPS", HR_QUERY: "PEOPLE", FACILITIES: "OPS", OTHER: "PEOPLE" });
  });

  it("uses unique lower-case emails and employee codes", async () => {
    const users = await db.user.findMany();
    expect(new Set(users.map((u) => u.email)).size).toBe(100);
    expect(users.every((u) => u.email === u.email.toLowerCase())).toBe(true);
    expect(new Set(users.map((u) => u.employeeCode)).size).toBe(100);
  });

  it("never makes anyone their own manager and keeps managers inside the company", async () => {
    const users = await db.user.findMany();
    const ids = new Set(users.map((u) => u.id));
    for (const u of users) {
      expect(u.managerId).not.toBe(u.id);
      if (u.managerId) expect(ids.has(u.managerId)).toBe(true);
    }
  });

  it("designates 7 recent new hires covering all four countries", async () => {
    const hires = await db.user.findMany({ where: { id: { in: base.newHireIds } } });
    expect(hires).toHaveLength(7);
    expect(new Set(hires.map((h) => h.country))).toEqual(new Set(["BANGLADESH", "MALAYSIA", "SRI_LANKA", "CYPRUS"]));
    for (const h of hires) {
      expect(h.status).toBe("ON_PROBATION");
      const days = (Date.now() - h.joiningDate.getTime()) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(9);
      expect(days).toBeLessThanOrEqual(56);
    }
  });

  it("creates the documented persona logins with the right shape", async () => {
    const hr = await db.user.findUnique({ where: { email: PERSONA_EMAILS.hrAdmin } });
    const manager = await db.user.findUnique({ where: { email: PERSONA_EMAILS.manager } });
    const hire = await db.user.findUnique({ where: { email: PERSONA_EMAILS.newHire } });
    const it = await db.user.findUnique({ where: { email: PERSONA_EMAILS.itSupport }, include: { department: true } });
    expect(hr?.role).toBe("HR_ADMIN");
    expect(manager?.role).toBe("MANAGER");
    expect(hire?.managerId).toBe(manager?.id);
    expect(base.newHireIds).toContain(hire?.id);
    expect(it?.department.code).toBe("ITOPS");
    expect(it?.status).toBe("ACTIVE");
  });

  it("is repeatable: clearing and seeding again yields the same data", async () => {
    const before = (await db.user.findMany({ orderBy: { employeeCode: "asc" } })).map((u) => `${u.employeeCode}|${u.fullName}|${u.email}|${u.country}|${u.role}`);
    await clearAll(db);
    await seedBase(db, await bcrypt.hash("x", 4));
    const after = (await db.user.findMany({ orderBy: { employeeCode: "asc" } })).map((u) => `${u.employeeCode}|${u.fullName}|${u.email}|${u.country}|${u.role}`);
    expect(await db.user.count()).toBe(100);
    expect(after).toEqual(before);
  });
});
