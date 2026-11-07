import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, makeDepartment, makeUser, resetDb } from "./db";

beforeEach(resetDb);
afterAll(() => db.$disconnect());

async function setup() {
  const dept = await makeDepartment();
  const user = await makeUser(dept.id);
  const category = await db.requestCategory.create({
    data: { code: "IT_EQUIPMENT", name: "IT Equipment", handlingDepartmentId: dept.id },
  });
  return { dept, user, category };
}

const newRequest = (s: Awaited<ReturnType<typeof setup>>, extra: object = {}) =>
  db.serviceRequest.create({
    data: {
      requesterId: s.user.id, categoryId: s.category.id, handlingDepartmentId: s.dept.id,
      title: "Laptop", description: "Need one", priority: "MEDIUM", ...extra,
    },
  });

describe("users constraints", () => {
  it("rejects a user managing themselves", async () => {
    const dept = await makeDepartment();
    const u = await makeUser(dept.id);
    await expect(db.user.update({ where: { id: u.id }, data: { managerId: u.id } })).rejects.toThrow(
      /users_not_own_manager/,
    );
  });

  it("rejects non-lowercase emails", async () => {
    const dept = await makeDepartment();
    await expect(makeUser(dept.id, { email: "Mixed@Example.com" })).rejects.toThrow(/users_email_lowercase/);
  });
});

describe("service_requests", () => {
  it("generates sequential SR- references from 1001", async () => {
    const s = await setup();
    const a = await newRequest(s);
    const b = await newRequest(s);
    expect(a.reference).toBe("SR-1001");
    expect(b.reference).toBe("SR-1002");
  });

  it("rejects a non-SUBMITTED request without an assignee", async () => {
    const s = await setup();
    await expect(newRequest(s, { status: "ASSIGNED" })).rejects.toThrow(/service_requests_assignee_when_assigned/);
  });

  it("accepts an assigned request with an assignee", async () => {
    const s = await setup();
    const r = await newRequest(s, { status: "ASSIGNED", assigneeId: s.user.id });
    expect(r.status).toBe("ASSIGNED");
  });
});

describe("onboarding constraints", () => {
  async function template() {
    const dept = await makeDepartment();
    const hr = await makeUser(dept.id, { role: "HR_ADMIN" });
    const tpl = await db.onboardingTemplate.create({
      data: { name: "T", description: "d", createdById: hr.id },
    });
    return { dept, hr, tpl };
  }

  it("requires a department for DEPARTMENT-owned template tasks", async () => {
    const { tpl } = await template();
    await expect(
      db.templateTask.create({
        data: { templateId: tpl.id, title: "x", description: "d", ownerType: "DEPARTMENT", offsetDays: 0, deadlineLabel: "Day 1", sortOrder: 1 },
      }),
    ).rejects.toThrow(/template_tasks_owner_department/);
  });

  it("forbids a department on MANAGER-owned template tasks", async () => {
    const { tpl, dept } = await template();
    await expect(
      db.templateTask.create({
        data: { templateId: tpl.id, title: "x", description: "d", ownerType: "MANAGER", ownerDepartmentId: dept.id, offsetDays: 0, deadlineLabel: "Day 1", sortOrder: 1 },
      }),
    ).rejects.toThrow(/template_tasks_owner_department/);
  });

  it("allows only one ACTIVE instance per employee, but a new one after completion", async () => {
    const { tpl, hr } = await template();
    const mk = (status?: "ACTIVE" | "COMPLETED") =>
      db.onboardingInstance.create({
        data: { employeeId: hr.id, templateId: tpl.id, startDate: new Date("2026-01-01"), ...(status && { status }) },
      });
    const first = await mk();
    await expect(mk()).rejects.toThrow(/onboarding_instances_one_active_per_employee|Unique constraint/);
    await db.onboardingInstance.update({ where: { id: first.id }, data: { status: "COMPLETED" } });
    await expect(mk()).resolves.toBeDefined();
  });
});

describe("row-level security and indexes", () => {
  it("enables RLS on every table, with no policies", async () => {
    const rls = await db.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    expect(rls.length).toBeGreaterThanOrEqual(11);
    expect(rls.filter((t) => !t.relrowsecurity)).toEqual([]);
    const policies = await db.$queryRaw<unknown[]>`SELECT 1 FROM pg_policies WHERE schemaname = 'public'`;
    expect(policies).toEqual([]);
  });

  it("keeps all four hand-written partial indexes", async () => {
    const idx = await db.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE '% WHERE %'`;
    expect(idx.map((i) => i.indexname).sort()).toEqual([
      "onboarding_instances_one_active_per_employee",
      "onboarding_tasks_assignee_queue_idx",
      "onboarding_tasks_dept_queue_idx",
      "service_requests_dept_queue_idx",
    ]);
  });
});
