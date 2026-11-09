import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearAll, seedBase } from "../prisma/seed/base";
import { seedOnboarding } from "../prisma/seed/onboarding";
import { seedRequests } from "../prisma/seed/requests";
import { addDays, findDependencyProblems, isBlocked, isOverdue, todayInDhaka, toIsoDate } from "@/services/onboarding-logic";
import { db } from "./db";

let base: Awaited<ReturnType<typeof seedBase>>;
const today = todayInDhaka();

async function seedAll() {
  await clearAll(db);
  const b = await seedBase(db, await bcrypt.hash("x", 4));
  await seedRequests(db, b);
  await seedOnboarding(db, b);
  return b;
}

beforeAll(async () => {
  base = await seedAll();
});
afterAll(() => db.$disconnect());

const allTasks = () => db.onboardingTask.findMany({ include: { dependsOn: true, instance: { include: { employee: true } } } });

describe("onboarding seed: templates", () => {
  it("creates Standard (10 tasks) and Engineering (12 tasks) templates", async () => {
    const t = await db.onboardingTemplate.findMany({ include: { _count: { select: { tasks: true } } } });
    expect(Object.fromEntries(t.map((x) => [x.name, x._count.tasks]))).toEqual({ "Standard Onboarding": 10, "Engineering Onboarding": 12 });
  });

  it("has valid dependency graphs (same template, no cycles) including the account → laptop → access chain", async () => {
    for (const tpl of await db.onboardingTemplate.findMany({ include: { tasks: true } })) {
      const keyOf = (id: string) => id;
      const nodes = tpl.tasks.map((t) => ({ key: keyOf(t.id), dependsOnKey: t.dependsOnId }));
      expect(findDependencyProblems(nodes)).toEqual([]);
      const ids = new Set(tpl.tasks.map((t) => t.id));
      for (const t of tpl.tasks) if (t.dependsOnId) expect(ids.has(t.dependsOnId)).toBe(true);
      const title = new Map(tpl.tasks.map((t) => [t.id, t]));
      const laptop = tpl.tasks.find((t) => t.title === "Provision laptop")!;
      expect(title.get(laptop.dependsOnId!)?.title).toBe("Create user accounts");
      const access = tpl.tasks.find((t) => t.title === "Grant software access")!;
      expect(access.dependsOnId).toBe(laptop.id);
    }
    const eng = await db.onboardingTemplate.findUniqueOrThrow({ where: { name: "Engineering Onboarding" }, include: { tasks: true } });
    const repo = eng.tasks.find((t) => t.title === "Grant repository access")!;
    expect(eng.tasks.find((t) => t.id === repo.dependsOnId)?.title).toBe("Grant software access");
  });

  it("assigns owners per the spec: IT, People, Operations, Legal, Engineering departments and managers", async () => {
    const tasks = await db.templateTask.findMany({ include: { ownerDepartment: true } });
    const owners = new Set(tasks.map((t) => (t.ownerType === "MANAGER" ? "MANAGER" : t.ownerDepartment!.code)));
    expect(owners).toEqual(new Set(["ITOPS", "PEOPLE", "OPS", "LEGAL", "MANAGER", "ENG"]));
  });
});

describe("onboarding seed: new hires", () => {
  it("onboards exactly the 7 designated new hires, each with one ACTIVE checklist from their joining date", async () => {
    const insts = await db.onboardingInstance.findMany({ include: { employee: { include: { department: true, status: true } }, template: true } });
    expect(insts).toHaveLength(7);
    expect(insts.map((i) => i.employeeId).sort()).toEqual([...base.newHireIds].sort());
    for (const i of insts) {
      expect(i.status).toBe("ACTIVE");
      expect(toIsoDate(i.startDate)).toBe(toIsoDate(i.employee.joiningDate));
      expect(i.template.name).toBe(i.employee.department.code === "ENG" ? "Engineering Onboarding" : "Standard Onboarding");
      expect(i.employee.status.code).toBe("ON_PROBATION");
    }
  });

  it("spans all four countries, several departments and several managers", async () => {
    const hires = await db.user.findMany({ where: { id: { in: base.newHireIds } }, include: { department: true, country: true } });
    expect(new Set(hires.map((h) => h.country.shortcode))).toEqual(new Set(["BD", "MY", "LK", "CY"]));
    expect(new Set(hires.map((h) => h.department.code)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(hires.map((h) => h.managerId)).size).toBeGreaterThanOrEqual(4);
    expect(hires.every((h) => {
      const days = (Date.now() - h.joiningDate.getTime()) / 86_400_000;
      return days >= 9 && days <= 56;
    })).toBe(true);
  });

  it("copies the template's tasks with due date = start + offset", async () => {
    for (const inst of await db.onboardingInstance.findMany({ include: { tasks: true, template: { include: { tasks: true } } } })) {
      expect(inst.tasks).toHaveLength(inst.template.tasks.length);
      for (const t of inst.tasks) {
        const src = inst.template.tasks.find((x) => x.sortOrder === t.sortOrder)!;
        expect(t.title).toBe(src.title);
        expect(toIsoDate(t.dueDate)).toBe(addDays(toIsoDate(inst.startDate), src.offsetDays));
      }
    }
  });

  it("assigns manager tasks to the hire's manager, and department tasks to a member of that department or to nobody yet", async () => {
    let assigned = 0, waiting = 0;
    for (const t of await allTasks()) {
      if (t.ownerType === "MANAGER") { expect(t.assigneeId).toBe(t.instance.employee.managerId); continue; }
      expect(t.ownerDepartmentId).not.toBeNull();
      if (t.assigneeId === null) {
        waiting++;
        expect(t.status, "started work always has an owner").toBe("NOT_STARTED");
      } else {
        assigned++;
        expect((await db.user.findUniqueOrThrow({ where: { id: t.assigneeId } })).departmentId).toBe(t.ownerDepartmentId);
      }
    }
    expect(assigned).toBeGreaterThan(0);
    expect(waiting).toBeGreaterThan(0); // the head has something to assign
  });
});

describe("onboarding seed: progress is realistic and consistent", () => {
  it("has completed, in-progress and not-started tasks", async () => {
    const s = new Set((await allTasks()).map((t) => t.status));
    expect(s).toEqual(new Set(["COMPLETED", "IN_PROGRESS", "NOT_STARTED"]));
  });

  it("has at least 3 overdue and at least 2 blocked tasks", async () => {
    const tasks = await allTasks();
    const facts = tasks.map((t) => ({ status: t.status, dependsOnStatus: t.dependsOn?.status ?? null, dueDate: toIsoDate(t.dueDate) }));
    expect(facts.filter((f) => isOverdue(f, today)).length).toBeGreaterThanOrEqual(3);
    expect(facts.filter((f) => isBlocked(f)).length).toBeGreaterThanOrEqual(2);
  });

  it("never completes or starts a task whose dependency is unfinished", async () => {
    for (const t of await allTasks()) {
      if (t.status !== "NOT_STARTED" && t.dependsOn) expect(t.dependsOn.status, t.title).toBe("COMPLETED");
    }
  });

  it("records who completed each task and when, in a sensible order", async () => {
    const tasks = await allTasks();
    const now = Date.now();
    for (const t of tasks) {
      if (t.status === "COMPLETED") {
        expect(t.completedAt && t.completedById).toBeTruthy();
        expect(t.completedAt!.getTime()).toBeLessThanOrEqual(now);
        if (t.dependsOn) expect(t.completedAt!.getTime()).toBeGreaterThanOrEqual(t.dependsOn.completedAt!.getTime());
      } else {
        expect(t.completedAt).toBeNull();
        expect(t.completedById).toBeNull();
      }
    }
  });

  it("lets only the assigned person complete a task", async () => {
    const completed = await db.onboardingTask.findMany({ where: { status: "COMPLETED" } });
    for (const t of completed) expect(t.completedById).toBe(t.assigneeId);
  });

  it("leaves every checklist unfinished", async () => {
    for (const inst of await db.onboardingInstance.findMany({ include: { tasks: true } })) {
      expect(inst.tasks.some((t) => t.status !== "COMPLETED")).toBe(true);
    }
  });

  it("gives the demo logins something to do", async () => {
    const itSupport = await db.user.findUniqueOrThrow({ where: { id: base.personas.itSupport } });
    const itTasks = await db.onboardingTask.count({ where: { ownerDepartmentId: itSupport.departmentId } });
    expect(itTasks).toBeGreaterThanOrEqual(21); // 3 IT tasks for each of 7 hires (more for Engineering)
    expect(await db.onboardingTask.count({ where: { assigneeId: base.personas.itSupport } })).toBeGreaterThanOrEqual(3); // the IT login has assigned work
    expect(await db.onboardingTask.count({ where: { assigneeId: base.personas.manager } })).toBeGreaterThanOrEqual(3);
    const hire = await db.user.findUniqueOrThrow({ where: { id: base.personas.newHire }, include: { department: true } });
    expect(hire.department.code).toBe("ENG");
    expect(hire.managerId).toBe(base.personas.manager);
  });

  it("is repeatable", async () => {
    const snap = async () => (await allTasks()).map((t) => `${t.instance.employee.email}|${t.title}|${t.status}|${toIsoDate(t.dueDate)}`).sort();
    const before = await snap();
    base = await seedAll();
    expect(await snap()).toEqual(before);
  });
});
