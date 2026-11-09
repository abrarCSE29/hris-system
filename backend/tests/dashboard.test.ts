import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as summaryRoute } from "../app/api/v1/dashboard/summary/route";
import { clearAll, seedBase } from "../prisma/seed/base";
import { seedOnboarding } from "../prisma/seed/onboarding";
import { seedRequests } from "../prisma/seed/requests";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { getDashboardSummary } from "@/services/dashboard";
import { addDays, todayInDhaka } from "@/services/onboarding-logic";
import { db } from "./db";

let base: Awaited<ReturnType<typeof seedBase>>;
const today = todayInDhaka();

async function seedAll() {
  await clearAll(db);
  base = await seedBase(db, await bcrypt.hash("x", 4));
  await seedRequests(db, base);
  await seedOnboarding(db, base);
}

beforeAll(seedAll);
afterAll(() => db.$disconnect());

/** The "waiting on IT Operations" entry of the summary. */
const onIt = (s: Awaited<ReturnType<typeof getDashboardSummary>>) => s.newHiresWaiting.find((w) => w.department.code === "ITOPS")!;

/** Independent SQL, written without reusing any application code, to cross-check the service. */
const sql = async <T>(query: string, ...params: unknown[]) => (await db.$queryRawUnsafe(query, ...params)) as T[];
const num = (x: unknown) => Number(x);

describe("GET /dashboard/summary (route)", () => {
  const call = async (userId: string | null) =>
    summaryRoute(new Request("http://x", { headers: userId ? { cookie: `${SESSION_COOKIE}=${await signSession(userId)}` } : {} }));

  it("is HR-only", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call(base.personas.manager)).status).toBe(403);
    expect((await call(base.personas.newHire)).status).toBe(403);
    expect((await call(base.personas.itSupport)).status).toBe(403);
  });

  it("returns the documented shape to an HR Admin", async () => {
    const res = await call(base.personas.hrAdmin);
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual([
      "asOf", "completionRateByCountry", "headcountByCountry", "newHiresWaiting", "onboarding", "requestsByCategory", "requestsByStatus",
    ]);
    expect(body.asOf).toBe(todayInDhaka());
    expect(Object.keys(body.onboarding).sort()).toEqual(["activeHires", "blockedTasks", "overdueTasks"]);
  });
});

describe("summary values match independent SQL (seeded data)", () => {
  it("headcount by country", async () => {
    const s = await getDashboardSummary(today);
    const rows = await sql<{ country: string; n: bigint }>("SELECT co.shortcode AS country, COUNT(*) n FROM users u JOIN countries co ON co.id = u.country_id GROUP BY 1");
    expect(Object.fromEntries(s.headcountByCountry.map((r) => [r.country.shortcode, r.count]))).toEqual(Object.fromEntries(rows.map((r) => [r.country, num(r.n)])));
    // Every country is listed, by name, each as the row from the countries table.
    expect(s.headcountByCountry.map((r) => r.country.shortcode)).toEqual(["BD", "CY", "MY", "LK"]);
    expect(s.headcountByCountry.map((r) => r.country.name)).toEqual(["Bangladesh", "Cyprus", "Malaysia", "Sri Lanka"]);
    expect(s.headcountByCountry.reduce((a, r) => a + r.count, 0)).toBe(100);
    expect(s.headcountByCountry.map((r) => r.count)).toEqual([40, 15, 25, 20]);
  });

  it("requests by status, in workflow order", async () => {
    const s = await getDashboardSummary(today);
    const rows = await sql<{ status: string; n: bigint }>("SELECT status::text, COUNT(*) n FROM service_requests GROUP BY 1");
    for (const r of s.requestsByStatus) expect(r.count).toBe(num(rows.find((x) => x.status === r.status)?.n ?? 0));
    expect(s.requestsByStatus.map((r) => r.status)).toEqual(["SUBMITTED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
    expect(s.requestsByStatus.map((r) => r.count)).toEqual([10, 12, 14, 16, 28]);
  });

  it("requests by category, with how many are still open", async () => {
    const s = await getDashboardSummary(today);
    const rows = await sql<{ code: string; total: bigint; open: bigint }>(
      `SELECT c.code::text, COUNT(r.id) total, COUNT(r.id) FILTER (WHERE r.status IN ('SUBMITTED','ASSIGNED','IN_PROGRESS')) open
       FROM request_categories c LEFT JOIN service_requests r ON r.category_id = c.id GROUP BY c.code`,
    );
    expect(s.requestsByCategory).toHaveLength(5);
    for (const c of s.requestsByCategory) {
      const row = rows.find((x) => x.code === c.category.code)!;
      expect([c.count, c.open]).toEqual([num(row.total), num(row.open)]);
      expect(c.open).toBeLessThanOrEqual(c.count);
    }
    expect(s.requestsByCategory.reduce((a, c) => a + c.count, 0)).toBe(80);
  });

  it("onboarding totals: active hires, overdue and blocked tasks", async () => {
    const s = await getDashboardSummary(today);
    const [{ n: hires }] = await sql<{ n: bigint }>("SELECT COUNT(*) n FROM onboarding_instances WHERE status = 'ACTIVE'");
    const [{ n: overdue }] = await sql<{ n: bigint }>(
      `SELECT COUNT(*) n FROM onboarding_tasks t JOIN onboarding_instances i ON i.id = t.instance_id
       WHERE i.status = 'ACTIVE' AND t.status <> 'COMPLETED' AND t.due_date < $1::date`, today);
    const [{ n: blocked }] = await sql<{ n: bigint }>(
      `SELECT COUNT(*) n FROM onboarding_tasks t JOIN onboarding_tasks d ON d.id = t.depends_on_id JOIN onboarding_instances i ON i.id = t.instance_id
       WHERE i.status = 'ACTIVE' AND t.status <> 'COMPLETED' AND d.status <> 'COMPLETED'`);
    expect(s.onboarding).toEqual({ activeHires: num(hires), overdueTasks: num(overdue), blockedTasks: num(blocked) });
    expect(s.onboarding.activeHires).toBe(7);
    expect(s.onboarding.overdueTasks).toBeGreaterThanOrEqual(3);
    expect(s.onboarding.blockedTasks).toBeGreaterThanOrEqual(2);
  });

  it("onboarding task completion by country", async () => {
    const s = await getDashboardSummary(today);
    const rows = await sql<{ country: string; hires: bigint; total: bigint; done: bigint }>(
      `SELECT co.shortcode AS country, COUNT(DISTINCT i.id) hires, COUNT(t.id) total, COUNT(t.id) FILTER (WHERE t.status='COMPLETED') done
       FROM onboarding_instances i JOIN users u ON u.id = i.employee_id JOIN countries co ON co.id = u.country_id LEFT JOIN onboarding_tasks t ON t.instance_id = i.id GROUP BY 1`);
    for (const c of s.completionRateByCountry) {
      const r = rows.find((x) => x.country === c.country.shortcode);
      expect(c.hires).toBe(num(r?.hires ?? 0));
      expect(c.tasksTotal).toBe(num(r?.total ?? 0));
      expect(c.tasksCompleted).toBe(num(r?.done ?? 0));
      expect(c.completionRate).toBe(c.tasksTotal === 0 ? 0 : Math.round((c.tasksCompleted / c.tasksTotal) * 100));
      expect(c.completionRate).toBeGreaterThanOrEqual(0);
      expect(c.completionRate).toBeLessThanOrEqual(100);
    }
    expect(s.completionRateByCountry.map((c) => c.country.shortcode)).toEqual(["BD", "CY", "MY", "LK"]);
    expect(s.completionRateByCountry.reduce((a, c) => a + c.hires, 0)).toBe(7);
  });

  it("new hires with open IT requests", async () => {
    const s = await getDashboardSummary(today);
    const rows = await sql<{ employee: string; ref: string }>(
      `SELECT DISTINCT i.employee_id::text employee, r.reference ref
       FROM onboarding_instances i JOIN service_requests r ON r.requester_id = i.employee_id
       JOIN departments d ON d.id = r.handling_department_id
       WHERE i.status = 'ACTIVE' AND d.code = 'ITOPS' AND r.status IN ('SUBMITTED','ASSIGNED','IN_PROGRESS')`);
    const expectedHires = new Set(rows.map((r) => r.employee));
    expect(onIt(s).count).toBe(expectedHires.size);
    expect(onIt(s).hires.map((h) => h.id).sort()).toEqual([...expectedHires].sort());
    expect(onIt(s).hires.flatMap((h) => h.openRequests.map((r) => r.reference)).sort()).toEqual(rows.map((r) => r.ref).sort());
    expect(onIt(s).count).toBeGreaterThanOrEqual(2); // seeded to demonstrate the insight
    for (const h of onIt(s).hires) {
      expect(h.instanceId).toBeTruthy();
      expect(h.openRequests.length).toBeGreaterThan(0);
      const [row] = await sql<{ department_id: string; name: string }>(
        `SELECT d.id AS department_id, d.name FROM users u JOIN departments d ON d.id = u.department_id WHERE u.id = $1::uuid`, h.id);
      expect(h.department).toEqual({ id: row.department_id, name: row.name });
    }
  });

  it("has one entry per department that handles requests, IT Operations first, each matching independent SQL", async () => {
    await seedAll();
    const s = await getDashboardSummary(today);
    expect(s.newHiresWaiting.map((w) => w.department.code)).toEqual(["ITOPS", "OPS", "PEOPLE"]);
    for (const w of s.newHiresWaiting) {
      const rows = await sql<{ employee: string; ref: string }>(
        `SELECT DISTINCT i.employee_id::text employee, r.reference ref
         FROM onboarding_instances i JOIN service_requests r ON r.requester_id = i.employee_id
         WHERE i.status = 'ACTIVE' AND r.handling_department_id = $1::uuid AND r.status IN ('SUBMITTED','ASSIGNED','IN_PROGRESS')`, w.department.id);
      expect(w.count).toBe(new Set(rows.map((r) => r.employee)).size);
      expect(w.hires.flatMap((h) => h.openRequests.map((r) => r.reference)).sort()).toEqual(rows.map((r) => r.ref).sort());
    }
  });

  it("lists a hire under every department they are waiting on, with only that department's requests", async () => {
    await seedAll();
    const hire = base.newHireIds[0];
    const ids = async (code: string) => (await db.requestCategory.findUniqueOrThrow({ where: { code: code as never } }));
    for (const code of ["IT_EQUIPMENT", "HR_QUERY"]) {
      const c = await ids(code);
      await db.serviceRequest.create({ data: { requesterId: hire, categoryId: c.id, handlingDepartmentId: c.handlingDepartmentId, title: `via ${code}`, description: "d", priority: "LOW" } });
    }
    const s = await getDashboardSummary(today);
    const people = s.newHiresWaiting.find((w) => w.department.code === "PEOPLE")!;
    const mine = people.hires.find((h) => h.id === hire)!;
    expect(mine.openRequests.map((r) => r.title)).toEqual(["via HR_QUERY"]);
    expect(onIt(s).hires.find((h) => h.id === hire)!.openRequests.map((r) => r.title)).toContain("via IT_EQUIPMENT");
    expect(onIt(s).hires.find((h) => h.id === hire)!.openRequests.map((r) => r.title)).not.toContain("via HR_QUERY");
  });

  it("depends on today's date for overdue tasks only", async () => {
    const far = await getDashboardSummary(addDays(today, 1000));
    const past = await getDashboardSummary(addDays(today, -1000));
    const [{ n }] = await sql<{ n: bigint }>(
      `SELECT COUNT(*) n FROM onboarding_tasks t JOIN onboarding_instances i ON i.id = t.instance_id WHERE i.status='ACTIVE' AND t.status <> 'COMPLETED'`);
    expect(far.onboarding.overdueTasks).toBe(num(n)); // far in the future, everything unfinished is overdue
    expect(past.onboarding.overdueTasks).toBe(0);
    expect(far.onboarding.blockedTasks).toBe(past.onboarding.blockedTasks); // blocked doesn't depend on the date
  });
});

describe("cross-module insight: new hires waiting on IT", () => {
  const cat = async (code: string) => db.requestCategory.findUniqueOrThrow({ where: { code: code as never } });
  const raise = async (requesterId: string, code: string, status: "SUBMITTED" | "RESOLVED" = "SUBMITTED") => {
    const c = await cat(code);
    return db.serviceRequest.create({
      data: { requesterId, categoryId: c.id, handlingDepartmentId: c.handlingDepartmentId, title: "t", description: "d", priority: "LOW", status, ...(status !== "SUBMITTED" && { assigneeId: base.personas.itSupport }) },
    });
  };
  const waiting = async () => onIt(await getDashboardSummary(today));

  it("counts a hire once however many open IT requests they have, and lists each request", async () => {
    await seedAll();
    // A hire with no IT requests yet: take someone who isn't currently in the list.
    const current = new Set((await waiting()).hires.map((h) => h.id));
    const hire = base.newHireIds.find((id) => !current.has(id))!;
    const before = (await waiting()).count;
    await raise(hire, "IT_EQUIPMENT");
    await raise(hire, "SOFTWARE_ACCESS");
    const after = await waiting();
    expect(after.count).toBe(before + 1);
    expect(after.hires.find((h) => h.id === hire)!.openRequests).toHaveLength(2);
  });

  it("ignores resolved IT requests, open non-IT requests, and people who are not new hires", async () => {
    await seedAll();
    const before = (await waiting()).count;
    const current = new Set((await waiting()).hires.map((h) => h.id));
    const hire = base.newHireIds.find((id) => !current.has(id))!;
    await raise(hire, "IT_EQUIPMENT", "RESOLVED"); // resolved
    await raise(hire, "FACILITIES"); // open but not IT
    await raise(hire, "HR_QUERY"); // open but not IT
    const veteran = (await db.user.findFirstOrThrow({ where: { id: { notIn: base.newHireIds }, role: { code: "EMPLOYEE" }, status: { code: "ACTIVE" } } })).id;
    await raise(veteran, "IT_EQUIPMENT"); // IT, open, but not a new hire
    expect((await waiting()).count).toBe(before);
  });

  it("drops a hire once their onboarding is complete or their IT request is resolved", async () => {
    await seedAll();
    const start = await waiting();
    expect(start.count).toBeGreaterThanOrEqual(2);
    const [a, b] = start.hires;

    await db.onboardingInstance.update({ where: { id: a.instanceId }, data: { status: "COMPLETED" } });
    let now = await waiting();
    expect(now.hires.map((h) => h.id)).not.toContain(a.id);
    expect(now.count).toBe(start.count - 1);

    await db.serviceRequest.updateMany({ where: { id: { in: b.openRequests.map((r) => r.id) } }, data: { status: "RESOLVED", assigneeId: base.personas.itSupport } });
    now = await waiting();
    expect(now.hires.map((h) => h.id)).not.toContain(b.id);
    expect(now.count).toBe(start.count - 2);
  });
});

describe("empty system", () => {
  it("lists every country, status and category with zeros instead of omitting them", async () => {
    await clearAll(db);
    await seedBase(db, await bcrypt.hash("x", 4)); // people and categories only: no requests, no onboarding
    const s = await getDashboardSummary(today);
    expect(s.requestsByStatus.map((r) => r.count)).toEqual([0, 0, 0, 0, 0]);
    expect(s.requestsByCategory).toHaveLength(5);
    expect(s.requestsByCategory.every((c) => c.count === 0 && c.open === 0)).toBe(true);
    expect(s.onboarding).toEqual({ activeHires: 0, overdueTasks: 0, blockedTasks: 0 });
    expect(s.newHiresWaiting.map((w) => [w.department.code, w.count, w.hires.length])).toEqual([["ITOPS", 0, 0], ["OPS", 0, 0], ["PEOPLE", 0, 0]]);
    expect(s.completionRateByCountry.every((c) => c.hires === 0 && c.completionRate === 0)).toBe(true);
    expect(s.headcountByCountry.reduce((a, r) => a + r.count, 0)).toBe(100);
  });
});
