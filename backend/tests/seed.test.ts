import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearAll, seedBase } from "../prisma/seed/base";
import { PERSONA_EMAILS } from "../prisma/seed/data";
import { db } from "./db";

let base: Awaited<ReturnType<typeof seedBase>>;
/** Number of users per role code, country shortcode or status code. */
const group = async (field: "country" | "role" | "status") => {
  const key = { country: "countryId", role: "roleId", status: "statusId" } as const;
  const rows = await db.user.groupBy({ by: [key[field]], _count: true });
  const names = new Map<string, string>(
    field === "country" ? (await db.country.findMany()).map((r) => [r.id, r.shortcode])
    : field === "role" ? (await db.role.findMany()).map((r) => [r.id, r.code])
    : (await db.userStatus.findMany()).map((r) => [r.id, r.code]),
  );
  return Object.fromEntries(rows.map((g) => [names.get(g[key[field]])!, g._count]));
};

beforeAll(async () => {
  await clearAll(db);
  base = await seedBase(db, await bcrypt.hash("x", 4));
});
afterAll(() => db.$disconnect());

describe("base seed", () => {
  it("creates 7 departments and 100 users with the required country split", async () => {
    expect(await db.department.count()).toBe(7);
    expect(await group("country")).toEqual({ BD: 40, MY: 25, LK: 20, CY: 15 });
  });

  it("has 3 HR admins, 7 managers (one per department) and 90 employees", async () => {
    expect(await group("role")).toEqual({ HR_ADMIN: 3, MANAGER: 7, EMPLOYEE: 90 });
  });

  it("has ~10 on probation and 4 on notice, the rest active", async () => {
    expect(await group("status")).toEqual({ ACTIVE: 86, ON_PROBATION: 10, ON_NOTICE: 4 });
  });

  it("gives every department a head who is a Manager in that department", async () => {
    const depts = await db.department.findMany({ include: { head: { include: { role: true } } } });
    for (const d of depts) {
      expect(d.head?.role.code).toBe("MANAGER");
      expect(d.head?.departmentId).toBe(d.id);
    }
  });

  it("has exactly one Manager per department, and that Manager is the listed head", async () => {
    const depts = await db.department.findMany();
    expect(depts).toHaveLength(7);
    for (const d of depts) {
      const managers = await db.user.findMany({ where: { departmentId: d.id, role: { code: "MANAGER" } } });
      expect(managers.map((u) => u.id)).toEqual([d.headId]);
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
    const hires = await db.user.findMany({ where: { id: { in: base.newHireIds } }, include: { country: true, status: true } });
    expect(hires).toHaveLength(7);
    expect(new Set(hires.map((h) => h.country.shortcode))).toEqual(new Set(["BD", "MY", "LK", "CY"]));
    for (const h of hires) {
      expect(h.status.code).toBe("ON_PROBATION");
      const days = (Date.now() - h.joiningDate.getTime()) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(9);
      expect(days).toBeLessThanOrEqual(56);
    }
  });

  it("creates the documented persona logins with the right shape", async () => {
    const hr = await db.user.findUnique({ where: { email: PERSONA_EMAILS.hrAdmin }, include: { role: true } });
    const manager = await db.user.findUnique({ where: { email: PERSONA_EMAILS.manager }, include: { role: true } });
    const hire = await db.user.findUnique({ where: { email: PERSONA_EMAILS.newHire } });
    const it = await db.user.findUnique({ where: { email: PERSONA_EMAILS.itSupport }, include: { department: true, status: true } });
    expect(hr?.role.code).toBe("HR_ADMIN");
    expect(manager?.role.code).toBe("MANAGER");
    expect(hire?.managerId).toBe(manager?.id);
    expect(base.newHireIds).toContain(hire?.id);
    expect(it?.department.code).toBe("ITOPS");
    expect(it?.status.code).toBe("ACTIVE");
  });

  it("uses exactly three roles: HR Admin, Employee, and one Manager per department who heads it", async () => {
    const users = await db.user.findMany({ include: { role: true, department: true } });
    expect(new Set(users.map((u) => u.role.code))).toEqual(new Set(["HR_ADMIN", "EMPLOYEE", "MANAGER"]));
    expect(await db.role.count()).toBe(3);
    const departments = await db.department.findMany();
    expect(departments).toHaveLength(7);
    for (const d of departments) {
      const managers = users.filter((u) => u.departmentId === d.id && u.role.code === "MANAGER");
      expect(managers.map((m) => m.id), d.name).toEqual([d.headId]);
      // Everyone else in the department reports to that Manager (HR Admins and Employees alike).
      for (const u of users.filter((x) => x.departmentId === d.id && x.role.code !== "MANAGER")) expect(u.managerId, u.email).toBe(d.headId);
    }
    expect(users.filter((u) => u.role.code === "HR_ADMIN")).toHaveLength(3);
  });

  it("varies job titles within the three roles", async () => {
    const users = await db.user.findMany({ include: { department: true, role: true } });
    expect(new Set(users.map((u) => u.jobTitle)).size).toBeGreaterThanOrEqual(35);
    for (const d of ["ENG", "OPS", "MKT", "ITOPS"]) {
      const titles = users.filter((u) => u.department.code === d && u.role.code === "EMPLOYEE").map((u) => u.jobTitle);
      expect(new Set(titles).size, d).toBeGreaterThanOrEqual(5);
    }
    // A title never turns into a fourth role: Managers and HR Admins keep their own titles.
    expect(new Set(users.filter((u) => u.role.code === "HR_ADMIN").map((u) => u.jobTitle)).size).toBeGreaterThanOrEqual(2);
  });

  it("gives the IT Operations Manager a documented login too", async () => {
    const itManager = await db.user.findUnique({ where: { email: PERSONA_EMAILS.itManager }, include: { role: true, department: true } });
    expect(itManager?.role.code).toBe("MANAGER");
    expect(itManager?.department.code).toBe("ITOPS");
    expect(base.personas.itManager).toBe(itManager?.id);
    expect((await db.department.findUniqueOrThrow({ where: { code: "ITOPS" } })).headId).toBe(itManager?.id);
  });

  it("is repeatable: clearing and seeding again yields the same data", async () => {
    const before = (await db.user.findMany({ orderBy: { employeeCode: "asc" }, include: { country: true, role: true } })).map((u) => `${u.employeeCode}|${u.fullName}|${u.email}|${u.country.shortcode}|${u.role.code}`);
    await clearAll(db);
    await seedBase(db, await bcrypt.hash("x", 4));
    const after = (await db.user.findMany({ orderBy: { employeeCode: "asc" }, include: { country: true, role: true } })).map((u) => `${u.employeeCode}|${u.fullName}|${u.email}|${u.country.shortcode}|${u.role.code}`);
    expect(await db.user.count()).toBe(100);
    expect(after).toEqual(before);
  });
});
