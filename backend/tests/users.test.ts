import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getAssignable } from "../app/api/v1/users/assignable/route";
import { GET as getMeta } from "../app/api/v1/meta/route";
import { GET as getUsers } from "../app/api/v1/users/route";
import { clearAll, seedBase } from "../prisma/seed/base";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { db } from "./db";

let ids: Awaited<ReturnType<typeof seedBase>>;
let engHeadId: string;
let employeeId: string;

beforeAll(async () => {
  await clearAll(db);
  ids = await seedBase(db, await bcrypt.hash("x", 4));
  const eng = await db.department.findUniqueOrThrow({ where: { code: "ENG" } });
  engHeadId = eng.headId!;
  employeeId = (await db.user.findFirstOrThrow({ where: { role: "EMPLOYEE", status: "ACTIVE" } })).id;
});
afterAll(() => db.$disconnect());

const as = async (userId: string | null, url: string) =>
  new Request(`http://x${url}`, userId ? { headers: { cookie: `${SESSION_COOKIE}=${await signSession(userId)}` } } : {});
const json = async (res: Response) => (await res.json()) as any;

describe("GET /users", () => {
  it("requires login (401) and rejects Employees (403)", async () => {
    expect((await getUsers(await as(null, "/api/v1/users"))).status).toBe(401);
    expect((await getUsers(await as(employeeId, "/api/v1/users"))).status).toBe(403);
  });

  it("gives HR Admin everyone, paginated and sorted by name", async () => {
    const res = await getUsers(await as(ids.personas.hrAdmin, "/api/v1/users"));
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ page: 1, pageSize: 20, total: 100 });
    expect(body.data).toHaveLength(20);
    const names: string[] = body.data.map((u: any) => u.fullName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const p2 = await json(await getUsers(await as(ids.personas.hrAdmin, "/api/v1/users?page=2&pageSize=20")));
    expect(p2.data[0].id).not.toBe(body.data[0].id);
    const last = await json(await getUsers(await as(ids.personas.hrAdmin, "/api/v1/users?page=5&pageSize=20")));
    expect(last.data).toHaveLength(20);
    expect((await json(await getUsers(await as(ids.personas.hrAdmin, "/api/v1/users?page=6&pageSize=20")))).data).toHaveLength(0);
  });

  it("never exposes password hashes", async () => {
    const text = await (await getUsers(await as(ids.personas.hrAdmin, "/api/v1/users?pageSize=100"))).text();
    expect(text).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
  });

  it("limits a Manager to their direct reports", async () => {
    const body = await json(await getUsers(await as(ids.personas.manager, "/api/v1/users?pageSize=100")));
    const reports = await db.user.count({ where: { managerId: ids.personas.manager } });
    expect(body.total).toBe(reports);
    expect(reports).toBeGreaterThan(0);
    expect(body.data.every((u: any) => u.managerId === ids.personas.manager)).toBe(true);
    expect(body.data.map((u: any) => u.id)).toContain(ids.personas.newHire);
  });

  it("does not let a Manager widen their scope with filters or search", async () => {
    const outsider = await db.user.findFirstOrThrow({ where: { managerId: { not: ids.personas.manager }, role: "EMPLOYEE" } });
    const bySearch = await json(await getUsers(await as(ids.personas.manager, `/api/v1/users?search=${encodeURIComponent(outsider.email)}`)));
    expect(bySearch.total).toBe(0);
    const byDept = await json(await getUsers(await as(ids.personas.manager, `/api/v1/users?departmentId=${outsider.departmentId}&country=${outsider.country}`)));
    expect(byDept.data.every((u: any) => u.managerId === ids.personas.manager)).toBe(true);
  });

  it("filters by country, status, department and combinations", async () => {
    const hr = ids.personas.hrAdmin;
    expect((await json(await getUsers(await as(hr, "/api/v1/users?country=MALAYSIA")))).total).toBe(25);
    expect((await json(await getUsers(await as(hr, "/api/v1/users?status=ON_NOTICE")))).total).toBe(4);
    expect((await json(await getUsers(await as(hr, "/api/v1/users?role=MANAGER")))).total).toBe(12);
    expect((await json(await getUsers(await as(hr, "/api/v1/users?role=HR_ADMIN")))).total).toBe(3);
    expect((await getUsers(await as(hr, "/api/v1/users?role=BOSS"))).status).toBe(422);
    expect((await json(await getUsers(await as(hr, `/api/v1/users?departmentId=${ids.departmentIds.ENG}`)))).total).toBe(30);
    const both = await json(await getUsers(await as(hr, `/api/v1/users?departmentId=${ids.departmentIds.ENG}&country=CYPRUS`)));
    expect(both.data.every((u: any) => u.country === "CYPRUS" && u.department.code === "ENG")).toBe(true);
  });

  it("searches name, email and employee code case-insensitively", async () => {
    const hr = ids.personas.hrAdmin;
    const target = await db.user.findFirstOrThrow({ where: { email: { not: { contains: "@hris.test" } } } }).catch(() => null);
    const u = target ?? (await db.user.findFirstOrThrow());
    const frag = u.fullName.slice(1, 5).toUpperCase();
    const byName = await json(await getUsers(await as(hr, `/api/v1/users?search=${encodeURIComponent(frag)}&pageSize=100`)));
    expect(byName.data.map((x: any) => x.id)).toContain(u.id);
    expect((await json(await getUsers(await as(hr, `/api/v1/users?search=${u.employeeCode.toLowerCase()}`)))).data[0].id).toBe(u.id);
    expect((await json(await getUsers(await as(hr, "/api/v1/users?search=IT.SUPPORT")))).data[0].email).toBe("it.support@hris.test");
  });

  it("treats empty filter params as absent and rejects invalid values with 422", async () => {
    const hr = ids.personas.hrAdmin;
    expect((await json(await getUsers(await as(hr, "/api/v1/users?country=&search=&status=")))).total).toBe(100);
    expect((await getUsers(await as(hr, "/api/v1/users?country=ATLANTIS"))).status).toBe(422);
    expect((await getUsers(await as(hr, "/api/v1/users?departmentId=not-a-uuid"))).status).toBe(422);
  });

  it("clamps absurd page sizes", async () => {
    const body = await json(await getUsers(await as(ids.personas.hrAdmin, "/api/v1/users?pageSize=100000")));
    expect(body.pageSize).toBe(20);
  });
});

describe("GET /users/assignable", () => {
  const url = (deptId: string) => `/api/v1/users/assignable?departmentId=${deptId}`;

  it("lets HR list any department, excluding people on notice", async () => {
    const body = await json(await getAssignable(await as(ids.personas.hrAdmin, url(ids.departmentIds.ENG))));
    const expected = await db.user.count({ where: { departmentId: ids.departmentIds.ENG, status: { in: ["ACTIVE", "ON_PROBATION"] } } });
    expect(body.data).toHaveLength(expected);
    const onNotice = await db.user.findMany({ where: { departmentId: ids.departmentIds.ENG, status: "ON_NOTICE" } });
    for (const u of onNotice) expect(body.data.map((x: any) => x.id)).not.toContain(u.id);
    expect(Object.keys(body.data[0]).sort()).toEqual(["employeeCode", "fullName", "id", "jobTitle"]);
  });

  it("lets a department head list only their own department", async () => {
    expect((await getAssignable(await as(engHeadId, url(ids.departmentIds.ENG)))).status).toBe(200);
    expect((await getAssignable(await as(engHeadId, url(ids.departmentIds.ITOPS)))).status).toBe(403);
  });

  it("lets any Manager list their own department, but rejects another department, Employees and a missing departmentId", async () => {
    const mgrDept = (await db.user.findUniqueOrThrow({ where: { id: ids.personas.manager } })).departmentId;
    const otherDept = Object.values(ids.departmentIds).find((d) => d !== mgrDept)!;
    expect((await getAssignable(await as(ids.personas.manager, url(mgrDept)))).status).toBe(200);
    expect((await getAssignable(await as(ids.personas.manager, url(otherDept)))).status).toBe(403);
    expect((await getAssignable(await as(employeeId, url(ids.departmentIds.ENG)))).status).toBe(403);
    expect((await getAssignable(await as(ids.personas.hrAdmin, "/api/v1/users/assignable"))).status).toBe(422);
    expect((await getAssignable(await as(null, url(ids.departmentIds.ENG)))).status).toBe(401);
  });
});

describe("GET /meta", () => {
  it("requires login", async () => {
    expect((await getMeta(await as(null, "/api/v1/meta"))).status).toBe(401);
  });

  it("returns departments, categories with handling departments, and enum values to any role", async () => {
    const body = await json(await getMeta(await as(employeeId, "/api/v1/meta")));
    expect(body.departments).toHaveLength(7);
    expect(body.requestCategories).toHaveLength(5);
    const it = body.requestCategories.find((c: any) => c.code === "IT_EQUIPMENT");
    expect(it.handlingDepartmentId).toBe(ids.departmentIds.ITOPS);
    expect(body.enums.countries).toEqual(["BANGLADESH", "MALAYSIA", "SRI_LANKA", "CYPRUS"]);
    expect(body.enums.requestStatuses).toEqual(["SUBMITTED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
    expect(body.enums.roles).toContain("HR_ADMIN");
  });
});
