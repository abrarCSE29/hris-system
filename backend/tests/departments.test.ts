import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as breakdownRoute } from "../app/api/v1/departments/breakdown/route";
import { GET as summaryRoute } from "../app/api/v1/dashboard/summary/route";
import { clearAll, seedBase } from "../prisma/seed/base";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { db } from "./db";

let base: Awaited<ReturnType<typeof seedBase>>;
let emptyId: string;

beforeAll(async () => {
  await clearAll(db);
  base = await seedBase(db, await bcrypt.hash("x", 4));
  emptyId = (await db.department.create({ data: { code: "EMPTY", name: "Zero Staff Dept" } })).id;
});
afterAll(() => db.$disconnect());

const sql = async <T>(query: string, ...params: unknown[]) => (await db.$queryRawUnsafe(query, ...params)) as T[];
const call = async (route: typeof breakdownRoute, userId: string | null) =>
  route(new Request("http://x", { headers: userId ? { cookie: `${SESSION_COOKIE}=${await signSession(userId)}` } : {} }));

type Breakdown = Awaited<ReturnType<typeof import("@/services/departments").getDepartmentBreakdown>>;
const get = async (): Promise<Breakdown> => (await call(breakdownRoute, base.personas.hrAdmin)).json();

describe("GET /departments/breakdown", () => {
  it("is HR-only", async () => {
    expect((await call(breakdownRoute, null)).status).toBe(401);
    expect((await call(breakdownRoute, base.personas.manager)).status).toBe(403);
    expect((await call(breakdownRoute, base.personas.newHire)).status).toBe(403);
    expect((await call(breakdownRoute, base.personas.itSupport)).status).toBe(403);
  });

  it("matches independent SQL for every department", async () => {
    const body = await get();
    const rows = await sql<{ id: string; headcount: bigint }>(
      `SELECT d.id, COUNT(u.id) AS headcount FROM departments d LEFT JOIN users u ON u.department_id = d.id GROUP BY d.id`,
    );
    expect(body.departments).toHaveLength(rows.length);
    for (const r of rows) expect(body.departments.find((d) => d.id === r.id)?.headcount).toBe(Number(r.headcount));

    for (const dept of body.departments) {
      const sum = (xs: { count: number }[]) => xs.reduce((n, x) => n + x.count, 0);
      expect(sum(dept.byCountry)).toBe(dept.headcount);
      expect(sum(dept.byStatus)).toBe(dept.headcount);
      expect(sum(dept.byRole)).toBe(dept.headcount);
    }

    const itops = body.departments.find((d) => d.code === "ITOPS")!;
    const [{ n }] = await sql<{ n: bigint }>(
      `SELECT COUNT(*) AS n FROM users u JOIN departments d ON d.id = u.department_id WHERE d.code = 'ITOPS' AND u.country = 'CYPRUS'`,
    );
    expect(itops.byCountry.find((c) => c.country === "CYPRUS")?.count).toBe(Number(n));
    expect(itops.head?.fullName).toBe("Farid Tan");
  });

  it("total equals the dashboard headcount", async () => {
    const body = await get();
    const summary = await (await call(summaryRoute, base.personas.hrAdmin)).json();
    const dashboardTotal = summary.headcountByCountry.reduce((n: number, c: { count: number }) => n + c.count, 0);
    expect(body.total).toBe(dashboardTotal);
  });

  it("lists an empty department with zeros and no head, and every value in every split", async () => {
    const dept = (await get()).departments.find((d) => d.id === emptyId)!;
    expect(dept.headcount).toBe(0);
    expect(dept.head).toBeNull();
    expect(dept.byCountry.map((c) => c.country)).toEqual(["BANGLADESH", "MALAYSIA", "SRI_LANKA", "CYPRUS"]);
    expect(dept.byStatus.map((s) => s.status)).toEqual(["ACTIVE", "ON_PROBATION", "ON_NOTICE"]);
    expect(dept.byRole.map((r) => r.role)).toEqual(["EMPLOYEE", "MANAGER", "HR_ADMIN"]);
    expect([...dept.byCountry, ...dept.byStatus, ...dept.byRole].every((x) => x.count === 0)).toBe(true);
  });

  it("sorts by headcount, largest first, then by name", async () => {
    const list = (await get()).departments;
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1], list[i]];
      expect(a.headcount > b.headcount || (a.headcount === b.headcount && a.name.localeCompare(b.name) <= 0)).toBe(true);
    }
    expect(list.at(-1)?.id).toBe(emptyId);
  });
});
