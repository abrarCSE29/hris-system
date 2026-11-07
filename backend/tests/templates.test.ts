import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getOne, PUT as putOne } from "../app/api/v1/onboarding/templates/[id]/route";
import { POST as postInstance } from "../app/api/v1/onboarding/instances/route";
import { GET as listRoute, POST as createRoute } from "../app/api/v1/onboarding/templates/route";
import { clearAll, seedBase } from "../prisma/seed/base";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { db } from "./db";

let ids: Awaited<ReturnType<typeof seedBase>>;
const hr = () => ids.personas.hrAdmin;

beforeAll(async () => {
  await clearAll(db);
  ids = await seedBase(db, await bcrypt.hash("x", 4));
});
beforeEach(async () => {
  await db.templateTask.deleteMany();
  await db.onboardingTemplate.deleteMany();
});
afterAll(() => db.$disconnect());

const json = async (res: Response) => (await res.json()) as any;
const cookie = async (userId: string | null) => (userId ? { cookie: `${SESSION_COOKIE}=${await signSession(userId)}` } : {});
const create = async (userId: string | null, body: unknown) =>
  createRoute(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...(await cookie(userId)) }, body: JSON.stringify(body) }));
const list = async (userId: string | null) => listRoute(new Request("http://x", { headers: await cookie(userId) }));
const get = async (userId: string | null, id: string) => getOne(new Request("http://x", { headers: await cookie(userId) }), { params: Promise.resolve({ id }) });

const task = (key: string, over: Record<string, unknown> = {}) => ({
  key, title: `Task ${key}`, description: "", ownerType: "MANAGER", offsetDays: 0, deadlineLabel: "Day 1", ...over,
});
const body = (tasks: unknown[], over: Record<string, unknown> = {}) => ({ name: "Standard", description: "d", tasks, ...over });
const itDept = () => ids.departmentIds.ITOPS;

describe("POST /onboarding/templates", () => {
  it("is HR-only", async () => {
    const b = body([task("a")]);
    expect((await create(null, b)).status).toBe(401);
    expect((await create(ids.personas.manager, b)).status).toBe(403);
    expect((await create(ids.personas.newHire, b)).status).toBe(403);
    expect(await db.onboardingTemplate.count()).toBe(0);
  });

  it("creates a template with ordered tasks and remaps dependency keys to ids", async () => {
    const res = await create(hr(), body([
      task("accounts", { ownerType: "DEPARTMENT", ownerDepartmentId: itDept(), title: "Create accounts" }),
      task("laptop", { ownerType: "DEPARTMENT", ownerDepartmentId: itDept(), title: "Provision laptop", offsetDays: 4, deadlineLabel: "Week 1", dependsOnKey: "accounts" }),
      task("repo", { ownerType: "DEPARTMENT", ownerDepartmentId: itDept(), title: "Grant repo access", offsetDays: 29, deadlineLabel: "Day 30", dependsOnKey: "laptop" }),
      task("welcome", { title: "Welcome chat" }),
    ]));
    const t = await json(res);
    expect(res.status).toBe(201);
    expect(t).toMatchObject({ name: "Standard", createdBy: { id: hr() } });
    expect(t.tasks.map((x: any) => x.title)).toEqual(["Create accounts", "Provision laptop", "Grant repo access", "Welcome chat"]);
    expect(t.tasks.map((x: any) => x.sortOrder)).toEqual([1, 2, 3, 4]);
    const [accounts, laptop, repo, welcome] = t.tasks;
    expect(accounts.dependsOnId).toBeNull();
    expect(laptop.dependsOnId).toBe(accounts.id);
    expect(repo.dependsOnId).toBe(laptop.id);
    expect(welcome).toMatchObject({ ownerType: "MANAGER", ownerDepartment: null });
    expect(accounts.ownerDepartment).toMatchObject({ code: "ITOPS" });
    expect([laptop.offsetDays, laptop.deadlineLabel]).toEqual([4, "Week 1"]);
  });

  it("accepts a custom deadline label with any offset", async () => {
    const res = await create(hr(), body([task("a", { deadlineLabel: "End of probation", offsetDays: 90 })]));
    expect(res.status).toBe(201);
  });

  it("rejects dependency problems with 422 and stores nothing", async () => {
    const cases: [string, unknown[]][] = [
      ["cycle", [task("a", { dependsOnKey: "b" }), task("b", { dependsOnKey: "a" })]],
      ["self dependency", [task("a", { dependsOnKey: "a" })]],
      ["unknown key", [task("a", { dependsOnKey: "nope" })]],
      ["duplicate keys", [task("a"), task("a")]],
    ];
    for (const [name, tasks] of cases) {
      const res = await create(hr(), body(tasks));
      expect(res.status, name).toBe(422);
      expect((await json(res)).error.details.length, name).toBeGreaterThan(0);
    }
    expect(await db.onboardingTemplate.count()).toBe(0);
    expect(await db.templateTask.count()).toBe(0);
  });

  it("reports which task a dependency problem is on", async () => {
    const res = await create(hr(), body([task("a"), task("b", { dependsOnKey: "zzz" })]));
    expect((await json(res)).error.details).toEqual([expect.objectContaining({ path: "tasks.1.dependsOnKey" })]);
  });

  it("enforces owner rules", async () => {
    expect((await create(hr(), body([task("a", { ownerType: "DEPARTMENT" })]))).status).toBe(422); // no department
    expect((await create(hr(), body([task("a", { ownerType: "MANAGER", ownerDepartmentId: itDept() })]))).status).toBe(422);
    const unknownDept = await create(hr(), body([task("a", { ownerType: "DEPARTMENT", ownerDepartmentId: crypto.randomUUID() })]));
    expect(unknownDept.status).toBe(422);
    expect((await json(unknownDept)).error.details[0].path).toBe("tasks.0.ownerDepartmentId");
  });

  it("rejects an offset that contradicts a standard label", async () => {
    const res = await create(hr(), body([task("a", { deadlineLabel: "Week 1", offsetDays: 7 })]));
    expect(res.status).toBe(422);
    expect((await json(res)).error.details[0].path).toBe("tasks.0.offsetDays");
  });

  it.each([
    ["no tasks", { tasks: [] }],
    ["blank name", { name: "  " }],
    ["negative offset", { tasks: [task("a", { offsetDays: -1, deadlineLabel: "Soon" })] }],
    ["fractional offset", { tasks: [task("a", { offsetDays: 1.5, deadlineLabel: "Soon" })] }],
    ["blank title", { tasks: [task("a", { title: " " })] }],
    ["unknown field", { createdById: crypto.randomUUID() }],
    ["unknown task field", { tasks: [task("a", { status: "COMPLETED" })] }],
  ])("returns 422 for %s", async (_n, over) => {
    expect((await create(hr(), body([task("a")], over))).status).toBe(422);
    expect(await db.onboardingTemplate.count()).toBe(0);
  });

  it("returns 409 for a duplicate template name", async () => {
    expect((await create(hr(), body([task("a")]))).status).toBe(201);
    const res = await create(hr(), body([task("b")]));
    expect(res.status).toBe(409);
    expect(await db.onboardingTemplate.count()).toBe(1);
  });
});

describe("GET /onboarding/templates", () => {
  it("lists templates with task counts (HR only)", async () => {
    await create(hr(), body([task("a"), task("b")], { name: "Zeta" }));
    await create(hr(), body([task("a")], { name: "Alpha" }));
    const out = await json(await list(hr()));
    expect(out.data.map((t: any) => [t.name, t.taskCount])).toEqual([["Alpha", 1], ["Zeta", 2]]);
    expect((await list(ids.personas.manager)).status).toBe(403);
    expect((await list(null)).status).toBe(401);
  });

  it("returns one template with ordered tasks, 404 for unknown or malformed ids", async () => {
    const created = await json(await create(hr(), body([task("a", { title: "First" }), task("b", { title: "Second" })])));
    const out = await json(await get(hr(), created.id));
    expect(out.tasks.map((t: any) => t.title)).toEqual(["First", "Second"]);
    expect((await get(hr(), crypto.randomUUID())).status).toBe(404);
    expect((await get(hr(), "nope")).status).toBe(404);
    expect((await get(ids.personas.manager, created.id)).status).toBe(403);
  });
});

describe("dependency order", () => {
  it("accepts a task that depends on one listed LATER in the request", async () => {
    // "Grant access" is listed first but waits for "Create accounts", which comes second.
    const res = await create(hr(), body([
      task("access", { title: "Grant access", dependsOnKey: "accounts" }),
      task("accounts", { title: "Create accounts" }),
    ]));
    const out = await json(res);
    expect(res.status).toBe(201);
    expect(out.tasks[0].dependsOnId).toBe(out.tasks[1].id);
  });
});

describe("PUT /onboarding/templates/:id", () => {
  const put = async (userId: string | null, id: string, payload: unknown) =>
    putOne(new Request("http://x", { method: "PUT", headers: { "content-type": "application/json", ...(await cookie(userId)) }, body: JSON.stringify(payload) }), {
      params: Promise.resolve({ id }),
    });
  const makeOriginal = async () =>
    json(await create(hr(), body([
      task("a", { title: "Create accounts", ownerType: "DEPARTMENT", ownerDepartmentId: itDept() }),
      task("b", { title: "Provision laptop", ownerType: "DEPARTMENT", ownerDepartmentId: itDept(), offsetDays: 4, deadlineLabel: "Week 1", dependsOnKey: "a" }),
    ], { name: "Original", description: "before" })));

  it("is HR-only", async () => {
    const t = await makeOriginal();
    expect((await put(null, t.id, body([task("a")]))).status).toBe(401);
    expect((await put(ids.personas.manager, t.id, body([task("a")]))).status).toBe(403);
    expect((await put(ids.personas.newHire, t.id, body([task("a")]))).status).toBe(403);
    expect((await json(await get(hr(), t.id))).name).toBe("Original");
  });

  it("replaces name, description and tasks, keeping the template's id, author and date", async () => {
    const t = await makeOriginal();
    const res = await put(hr(), t.id, body([
      task("x", { title: "Welcome chat" }),
      task("y", { title: "Sign contract", ownerType: "DEPARTMENT", ownerDepartmentId: ids.departmentIds.PEOPLE, deadlineLabel: "Day 3", offsetDays: 2 }),
      task("z", { title: "Payroll", ownerType: "DEPARTMENT", ownerDepartmentId: ids.departmentIds.PEOPLE, offsetDays: 4, deadlineLabel: "Week 1", dependsOnKey: "y" }),
    ], { name: "Renamed", description: "after" }));
    const out = await json(res);
    expect(res.status).toBe(200);
    expect(out).toMatchObject({ id: t.id, name: "Renamed", description: "after", createdBy: { id: hr() }, createdAt: t.createdAt });
    expect(out.tasks.map((k: any) => k.title)).toEqual(["Welcome chat", "Sign contract", "Payroll"]);
    expect(out.tasks.map((k: any) => k.sortOrder)).toEqual([1, 2, 3]);
    expect(out.tasks[2].dependsOnId).toBe(out.tasks[1].id);
    expect(out.tasks[0]).toMatchObject({ ownerType: "MANAGER", ownerDepartment: null });
    // Nothing of the old task list is left behind.
    expect(await db.templateTask.count({ where: { templateId: t.id } })).toBe(3);
    expect(await db.templateTask.count()).toBe(3);
  });

  it("lets a task depend on one that is listed later, and lets tasks be reordered", async () => {
    const t = await makeOriginal();
    const res = await put(hr(), t.id, body([
      task("b", { title: "Second step", dependsOnKey: "a" }),
      task("a", { title: "First step" }),
    ]));
    const out = await json(res);
    expect(res.status).toBe(200);
    expect(out.tasks[0].dependsOnId).toBe(out.tasks[1].id);
  });

  it("does NOT change checklists that were already assigned from the template", async () => {
    const t = await makeOriginal();
    const assigned = await json(await postInstance(new Request("http://x", {
      method: "POST", headers: { "content-type": "application/json", ...(await cookie(hr())) },
      body: JSON.stringify({ employeeId: ids.personas.newHire, templateId: t.id, startDate: "2026-11-01" }),
    })));
    expect(assigned.tasks.map((k: any) => k.title)).toEqual(["Create accounts", "Provision laptop"]);
    const before = await db.onboardingTask.findMany({ where: { instanceId: assigned.id }, orderBy: { sortOrder: "asc" } });

    expect((await put(hr(), t.id, body([task("only", { title: "Something else entirely" })], { name: "Original" }))).status).toBe(200);

    const after = await db.onboardingTask.findMany({ where: { instanceId: assigned.id }, orderBy: { sortOrder: "asc" } });
    expect(after).toEqual(before); // identical rows, same ids, same dependencies
    expect((await db.onboardingInstance.findUniqueOrThrow({ where: { id: assigned.id } })).templateId).toBe(t.id);
    await db.onboardingTask.deleteMany();
    await db.onboardingInstance.deleteMany();
  });

  it("applies the edit to assignments made afterwards", async () => {
    const t = await makeOriginal();
    await put(hr(), t.id, body([task("n", { title: "Brand new task" })], { name: "Original" }));
    const assigned = await json(await postInstance(new Request("http://x", {
      method: "POST", headers: { "content-type": "application/json", ...(await cookie(hr())) },
      body: JSON.stringify({ employeeId: ids.personas.newHire, templateId: t.id }),
    })));
    expect(assigned.tasks.map((k: any) => k.title)).toEqual(["Brand new task"]);
    await db.onboardingTask.deleteMany();
    await db.onboardingInstance.deleteMany();
  });

  it("allows keeping the same name, but rejects another template's name with 409", async () => {
    const a = await makeOriginal();
    await create(hr(), body([task("a")], { name: "Other" }));
    expect((await put(hr(), a.id, body([task("a")], { name: "Original" }))).status).toBe(200);
    const clash = await put(hr(), a.id, body([task("a")], { name: "Other" }));
    expect(clash.status).toBe(409);
    expect((await json(await get(hr(), a.id))).name).toBe("Original");
  });

  it("validates exactly like create, and a rejected edit changes nothing", async () => {
    const t = await makeOriginal();
    const bad: [string, unknown][] = [
      ["cycle", body([task("a", { dependsOnKey: "b" }), task("b", { dependsOnKey: "a" })], { name: "Original" })],
      ["unknown dependency", body([task("a", { dependsOnKey: "zzz" })], { name: "Original" })],
      ["unknown department", body([task("a", { ownerType: "DEPARTMENT", ownerDepartmentId: crypto.randomUUID() })], { name: "Original" })],
      ["no tasks", body([], { name: "Original" })],
      ["offset contradicts label", body([task("a", { deadlineLabel: "Week 1", offsetDays: 7 })], { name: "Original" })],
      ["unknown field", { ...body([task("a")], { name: "Original" }), createdById: hr() }],
    ];
    for (const [name, payload] of bad) expect((await put(hr(), t.id, payload)).status, name).toBe(422);

    const after = await json(await get(hr(), t.id));
    expect(after.description).toBe("before");
    expect(after.tasks.map((k: any) => k.title)).toEqual(["Create accounts", "Provision laptop"]);
    expect(after.tasks[1].dependsOnId).toBe(after.tasks[0].id);
  });

  it("returns 404 for unknown or malformed ids", async () => {
    expect((await put(hr(), crypto.randomUUID(), body([task("a")]))).status).toBe(404);
    expect((await put(hr(), "nope", body([task("a")]))).status).toBe(404);
  });
});
