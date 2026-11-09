import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getInstance } from "../app/api/v1/onboarding/instances/[id]/route";
import { GET as listInstancesRoute, POST as postInstance } from "../app/api/v1/onboarding/instances/route";
import { GET as getMine } from "../app/api/v1/onboarding/me/route";
import { POST as postAssign } from "../app/api/v1/onboarding/tasks/[id]/assign/route";
import { POST as postTransition } from "../app/api/v1/onboarding/tasks/[id]/transitions/route";
import { GET as listTasksRoute } from "../app/api/v1/onboarding/tasks/route";
import { POST as postTemplate } from "../app/api/v1/onboarding/templates/route";
import { POST as postUser } from "../app/api/v1/users/route";
import { clearAll, seedBase } from "../prisma/seed/base";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { addDays, todayInDhaka } from "@/services/onboarding-logic";
import { countryId, db } from "./db";

let ids: Awaited<ReturnType<typeof seedBase>>;
let tplId: string;
let itMember: string;
let itMember2: string;
let peopleMember: string;
let itHead: string; // Manager who heads IT Operations
let peopleHead: string;
let otherManager: string;
let cyprusId: string;
let engOutsider: string; // Engineering employee, same department as the hire, not involved
const today = () => todayInDhaka();

const json = async (res: Response) => (await res.json()) as any;
const cookie = async (userId: string | null) => (userId ? { cookie: `${SESSION_COOKIE}=${await signSession(userId)}` } : {});
const send = async (handler: (r: Request, c?: any) => Promise<Response>, userId: string | null, opts: { method?: string; url?: string; body?: unknown; id?: string } = {}) =>
  handler(
    new Request(opts.url ?? "http://x/api", {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: { "content-type": "application/json", ...(await cookie(userId)) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    opts.id ? { params: Promise.resolve({ id: opts.id }) } : undefined,
  );

beforeAll(async () => {
  await clearAll(db);
  ids = await seedBase(db, await bcrypt.hash("x", 4));
  cyprusId = await countryId("CY");
  const it = await db.department.findUniqueOrThrow({ where: { code: "ITOPS" } });
  const people = await db.department.findUniqueOrThrow({ where: { code: "PEOPLE" } });
  const eng = await db.department.findUniqueOrThrow({ where: { code: "ENG" } });
  const members = await db.user.findMany({ where: { departmentId: it.id, role: { code: "EMPLOYEE" }, status: { code: "ACTIVE" } }, orderBy: { employeeCode: "asc" } });
  [itMember, itMember2] = [members[0].id, members[1].id];
  itHead = it.headId!;
  peopleHead = people.headId!;
  peopleMember = (await db.user.findFirstOrThrow({ where: { departmentId: people.id, role: { code: "EMPLOYEE" } } })).id;
  // A Manager who has nothing to do with the hire, IT tasks or People tasks.
  otherManager = (await db.user.findFirstOrThrow({ where: { role: { code: "MANAGER" }, department: { code: { notIn: ["ENG", "ITOPS", "PEOPLE"] } } } })).id;
  engOutsider = (await db.user.findFirstOrThrow({ where: { departmentId: eng.id, role: { code: "EMPLOYEE" }, id: { not: ids.personas.newHire } } })).id;

  const task = (key: string, over: object) => ({ key, title: key, description: "", ownerType: "DEPARTMENT", offsetDays: 0, deadlineLabel: "Day 1", ...over });
  const res = await send(postTemplate, ids.personas.hrAdmin, {
    body: {
      name: "Standard", description: "d",
      tasks: [
        task("Create accounts", { ownerDepartmentId: it.id }),
        task("Provision laptop", { ownerDepartmentId: it.id, offsetDays: 4, deadlineLabel: "Week 1", dependsOnKey: "Create accounts" }),
        task("Grant repo access", { ownerDepartmentId: it.id, offsetDays: 29, deadlineLabel: "Day 30", dependsOnKey: "Provision laptop" }),
        task("Welcome chat", { ownerType: "MANAGER" }),
        task("HR paperwork", { ownerDepartmentId: people.id, offsetDays: 2, deadlineLabel: "Day 3" }),
      ],
    },
  });
  tplId = (await json(res)).id;
});
beforeEach(async () => {
  await db.onboardingTask.deleteMany();
  await db.onboardingInstance.deleteMany();
});
afterAll(() => db.$disconnect());

/** Assigns the standard checklist to the new-hire persona, starting 10 days ago unless told otherwise. */
async function assign(startDate = addDays(today(), -10), employeeId = ids.personas.newHire) {
  const res = await send(postInstance, ids.personas.hrAdmin, { body: { employeeId, templateId: tplId, startDate } });
  return { res, body: await json(res) };
}
const taskIdByTitle = async (instanceId: string, title: string) =>
  (await db.onboardingTask.findFirstOrThrow({ where: { instanceId, title } })).id;
const act = async (userId: string | null, taskId: string, action: string) =>
  send(postTransition, userId, { body: { action }, id: taskId });
/** Who the IT head would hand things to; the tests that are about working a task, not about delegating, start from here. */
const delegate = async (instanceId: string, to: Record<string, string> = {}) => {
  const owners: Record<string, string> = { "Create accounts": itMember, "Provision laptop": itMember, "Grant repo access": itMember, "HR paperwork": peopleMember, ...to };
  for (const [title, userId] of Object.entries(owners)) await db.onboardingTask.updateMany({ where: { instanceId, title }, data: { assigneeId: userId } });
};
const giveTask = async (userId: string | null, taskId: string, assigneeId: unknown) => send(postAssign, userId, { body: { assigneeId }, id: taskId });
const byTitle = (body: any, title: string) => body.tasks.find((t: any) => t.title === title);

// ═════════════════════════════════ Task 13 ═══════════════════════════════════

describe("POST /onboarding/instances", () => {
  it("copies the template onto the employee with dated, owned, linked tasks", async () => {
    const start = addDays(today(), -10);
    const { res, body } = await assign(start);
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ status: "ACTIVE", startDate: start, employee: { id: ids.personas.newHire }, template: { name: "Standard" } });
    expect(body.tasks).toHaveLength(5);

    expect(body.tasks.map((t: any) => [t.title, t.dueDate])).toEqual([
      ["Create accounts", start], ["Provision laptop", addDays(start, 4)], ["Grant repo access", addDays(start, 29)],
      ["Welcome chat", start], ["HR paperwork", addDays(start, 2)],
    ]);
    // Manager tasks go to the hire's manager; department tasks have no individual assignee.
    expect(byTitle(body, "Welcome chat").assignee).toMatchObject({ id: ids.personas.manager });
    expect(byTitle(body, "Create accounts").assignee).toBeNull();
    // Dependencies point at the copies in this instance.
    expect(byTitle(body, "Provision laptop").dependsOn).toEqual({ id: byTitle(body, "Create accounts").id, title: "Create accounts" });
    const copies = await db.onboardingTask.findMany({ where: { instanceId: body.id } });
    const templateIds = (await db.templateTask.findMany()).map((t) => t.id);
    for (const c of copies) if (c.dependsOnId) expect(copies.map((x) => x.id)).toContain(c.dependsOnId);
    expect(copies.every((c) => !templateIds.includes(c.id))).toBe(true);
    expect(copies.every((c) => c.status === "NOT_STARTED")).toBe(true);
  });

  it("starts on the employee's joining date when no start date is given", async () => {
    const hire = await db.user.findUniqueOrThrow({ where: { id: ids.personas.newHire } });
    const res = await send(postInstance, ids.personas.hrAdmin, { body: { employeeId: hire.id, templateId: tplId } });
    expect((await json(res)).startDate).toBe(hire.joiningDate.toISOString().slice(0, 10));
  });

  it("calculates blocked and overdue, and progress counts, from the start date", async () => {
    const { body } = await assign(); // started 10 days ago
    expect(body.progress).toEqual({ total: 5, completed: 0, inProgress: 0, notStarted: 3, blocked: 2, overdue: 4, percentComplete: 0 });
    expect(byTitle(body, "Create accounts")).toMatchObject({ displayStatus: "NOT_STARTED", blocked: false, overdue: true });
    expect(byTitle(body, "Provision laptop")).toMatchObject({ displayStatus: "BLOCKED", blocked: true, overdue: true });
    expect(byTitle(body, "Grant repo access")).toMatchObject({ displayStatus: "BLOCKED", overdue: false }); // due in 19 days
  });

  it("shows a chain unblocking one step at a time as dependencies are completed", async () => {
    const { body } = await assign();
    const a = await taskIdByTitle(body.id, "Create accounts");
    await db.onboardingTask.update({ where: { id: a }, data: { status: "COMPLETED" } });
    const after = await json(await send(getInstance, ids.personas.hrAdmin, { id: body.id }));
    expect(byTitle(after, "Provision laptop").displayStatus).toBe("NOT_STARTED");
    expect(byTitle(after, "Grant repo access").displayStatus).toBe("BLOCKED");
    expect(after.progress).toMatchObject({ completed: 1, blocked: 1, percentComplete: 20 });
  });

  it("a task due today is not overdue", async () => {
    const { body } = await assign(addDays(today(), 0));
    expect(body.progress.overdue).toBe(0);
  });

  it("returns 409 if the employee already has an active checklist, and allows another once it is completed", async () => {
    const first = await assign();
    expect((await assign()).res.status).toBe(409);
    expect(await db.onboardingInstance.count()).toBe(1);
    await db.onboardingInstance.update({ where: { id: first.body.id }, data: { status: "COMPLETED" } });
    expect((await assign()).res.status).toBe(201);
  });

  it("rejects unknown employees and templates with 422, creating nothing", async () => {
    const bad = (over: object) => send(postInstance, ids.personas.hrAdmin, { body: { employeeId: ids.personas.newHire, templateId: tplId, ...over } });
    expect((await bad({ employeeId: crypto.randomUUID() })).status).toBe(422);
    expect((await bad({ templateId: crypto.randomUUID() })).status).toBe(422);
    expect((await bad({ startDate: "soon" })).status).toBe(422);
    expect((await bad({ status: "COMPLETED" })).status).toBe(422);
    expect(await db.onboardingInstance.count()).toBe(0);
    expect(await db.onboardingTask.count()).toBe(0);
  });

  it("rejects manager tasks for an employee with no manager", async () => {
    const head = (await db.department.findUniqueOrThrow({ where: { code: "ITOPS" } })).headId!; // heads have no manager
    expect((await db.user.findUniqueOrThrow({ where: { id: head } })).managerId).toBeNull();
    const res = await send(postInstance, ids.personas.hrAdmin, { body: { employeeId: head, templateId: tplId } });
    expect(res.status).toBe(422);
    expect(await db.onboardingInstance.count()).toBe(0);
  });

  it("is HR-only", async () => {
    const body = { employeeId: ids.personas.newHire, templateId: tplId };
    expect((await send(postInstance, null, { body })).status).toBe(401);
    expect((await send(postInstance, ids.personas.manager, { body })).status).toBe(403);
    expect((await send(postInstance, ids.personas.newHire, { body })).status).toBe(403);
    expect(await db.onboardingInstance.count()).toBe(0);
  });
});

describe("reading checklists (scope)", () => {
  it("the hire, their manager and HR can open it; others get 404", async () => {
    const { body } = await assign();
    for (const who of [ids.personas.newHire, ids.personas.manager, ids.personas.hrAdmin]) {
      expect((await send(getInstance, who, { id: body.id })).status).toBe(200);
    }
    for (const who of [otherManager, itMember, peopleMember, engOutsider]) {
      expect((await send(getInstance, who, { id: body.id })).status).toBe(404);
    }
    expect((await send(getInstance, null, { id: body.id })).status).toBe(401);
    expect((await send(getInstance, ids.personas.hrAdmin, { id: "nope" })).status).toBe(404);
  });

  it("/onboarding/me returns the user's own checklist, or null", async () => {
    expect(await json(await send(getMine, ids.personas.newHire))).toBeNull();
    const { body } = await assign();
    expect((await json(await send(getMine, ids.personas.newHire))).id).toBe(body.id);
    expect(await json(await send(getMine, ids.personas.manager))).toBeNull(); // managers don't see their reports' lists here
  });

  it("/onboarding/me keeps showing the finished checklist when there is no active one", async () => {
    const { body } = await assign();
    await db.onboardingInstance.update({ where: { id: body.id }, data: { status: "COMPLETED" } });
    expect(await json(await send(getMine, ids.personas.newHire))).toMatchObject({ id: body.id, status: "COMPLETED" });
  });

  it("lists progress per hire: HR sees all, a Manager only direct reports, others are refused", async () => {
    await assign();
    const other = await db.user.findFirstOrThrow({ where: { managerId: otherManager, role: { code: "EMPLOYEE" } } });
    await assign(addDays(today(), -3), other.id);

    const hr = await json(await send(listInstancesRoute, ids.personas.hrAdmin));
    expect(hr.total).toBe(2);
    expect(hr.data[0]).toMatchObject({ progress: { total: 5 }, employee: { fullName: expect.any(String) } });
    expect(hr.data[0]).not.toHaveProperty("tasks");

    const mgr = await json(await send(listInstancesRoute, ids.personas.manager));
    expect(mgr.data.map((i: any) => i.employee.id)).toEqual([ids.personas.newHire]);
    expect((await send(listInstancesRoute, ids.personas.newHire)).status).toBe(403);
  });

  it("filters the list by country and status", async () => {
    const { body } = await assign();
    const country = body.employee.country.id;
    const url = (qs: string) => `http://x/api/v1/onboarding/instances${qs}`;
    expect((await json(await send(listInstancesRoute, ids.personas.hrAdmin, { url: url(`?countryId=${country}`) }))).total).toBe(1);
    const otherCountry = (await db.country.findFirstOrThrow({ where: { id: { not: country } } })).id;
    expect((await json(await send(listInstancesRoute, ids.personas.hrAdmin, { url: url(`?countryId=${otherCountry}`) }))).total).toBe(0);
    const unknown = await send(listInstancesRoute, ids.personas.hrAdmin, { url: url(`?countryId=${crypto.randomUUID()}`) });
    expect(unknown.status).toBe(422);
    expect((await json(unknown)).error.details[0].path).toBe("countryId");
    expect((await json(await send(listInstancesRoute, ids.personas.hrAdmin, { url: url("?status=COMPLETED") }))).total).toBe(0);
    expect((await send(listInstancesRoute, ids.personas.hrAdmin, { url: url("?status=NOPE") })).status).toBe(422);
  });
});

describe("POST /users with templateId", () => {
  const newUser = (over: object = {}) => ({
    fullName: "Fresh Starter", email: "fresh@hris.test", countryId: cyprusId, departmentId: "", managerId: "", jobTitle: "Engineer", joiningDate: "2026-11-02", ...over,
  });
  const create = async (over: object = {}) =>
    send(postUser, ids.personas.hrAdmin, { body: newUser({ departmentId: ids.departmentIds.ENG, managerId: ids.personas.manager, ...over }) });

  it("creates the user and their checklist together, starting on the joining date", async () => {
    const res = await create({ templateId: tplId });
    const out = await json(res);
    expect(res.status).toBe(201);
    expect(out.onboarding).toMatchObject({ taskCount: 5 });
    const inst = await db.onboardingInstance.findUniqueOrThrow({ where: { id: out.onboarding.instanceId }, include: { tasks: true } });
    expect(inst.employeeId).toBe(out.user.id);
    expect(inst.startDate.toISOString().slice(0, 10)).toBe("2026-11-02");
    expect(inst.tasks.find((t) => t.title === "Welcome chat")?.assigneeId).toBe(ids.personas.manager);
    // The new hire is now flagged as a new hire.
    expect((await db.onboardingInstance.count({ where: { employeeId: out.user.id, status: "ACTIVE" } }))).toBe(1);
  });

  it("creates neither user nor checklist for an unknown template", async () => {
    const before = await db.user.count();
    const res = await create({ email: "no.template@hris.test", templateId: crypto.randomUUID() });
    expect(res.status).toBe(422);
    expect(await db.user.count()).toBe(before);
  });

  it("still works without a template", async () => {
    const out = await json(await create({ email: "plain@hris.test" }));
    expect(out.onboarding).toBeUndefined();
    expect(await db.onboardingInstance.count({ where: { employeeId: out.user.id } })).toBe(0);
  });
});

// ═════════════════════════════════ Task 14 ═══════════════════════════════════

describe("GET /onboarding/tasks (queue)", () => {
  const queue = async (userId: string, qs = "") =>
    json(await send(listTasksRoute, userId, { url: `http://x/api/v1/onboarding/tasks${qs}` }));
  const titles = (q: any) => q.data.map((t: any) => t.title).sort();

  it("shows the head every task of their department, and everyone else only what is assigned to them", async () => {
    const { body } = await assign();
    // Nothing is assigned yet: a plain member of IT sees none of IT's tasks, the head sees all of them.
    expect(titles(await queue(itHead))).toEqual(["Create accounts", "Grant repo access", "Provision laptop"]);
    expect(titles(await queue(itMember))).toEqual([]);
    expect(titles(await queue(itMember2))).toEqual([]);
    expect(titles(await queue(peopleHead))).toEqual(["HR paperwork"]);
    expect(titles(await queue(peopleMember))).toEqual([]);
    expect(titles(await queue(ids.personas.manager))).toEqual(["Welcome chat"]); // the hire's manager owns manager tasks
    expect(titles(await queue(otherManager))).toEqual([]);
    expect(titles(await queue(ids.personas.newHire))).toEqual([]);
    expect(titles(await queue(engOutsider))).toEqual([]);
    expect((await queue(ids.personas.hrAdmin)).total).toBe(5);

    // Once the head assigns, the assignee sees it and the other member still doesn't.
    await delegate(body.id, { "Provision laptop": itMember2 });
    expect(titles(await queue(itMember))).toEqual(["Create accounts", "Grant repo access"]);
    expect(titles(await queue(itMember2))).toEqual(["Provision laptop"]);
    expect(titles(await queue(itHead))).toEqual(["Create accounts", "Grant repo access", "Provision laptop"]);
    expect(titles(await queue(peopleMember))).toEqual(["HR paperwork"]);
  });

  it("filters to the tasks that still need an owner", async () => {
    const { body } = await assign();
    await delegate(body.id, { "Grant repo access": itHead });
    await db.onboardingTask.updateMany({ where: { instanceId: body.id, title: "Create accounts" }, data: { assigneeId: null } });
    expect(titles(await queue(itHead, "?assigned=false"))).toEqual(["Create accounts"]);
    expect(titles(await queue(itHead, "?assigned=true"))).toEqual(["Grant repo access", "Provision laptop"]);
    // MANAGER tasks are never "unassigned": they have their manager from the start.
    expect(titles(await queue(ids.personas.hrAdmin, "?assigned=false"))).toEqual(["Create accounts"]);
    expect((await send(listTasksRoute, itHead, { url: "http://x/api/v1/onboarding/tasks?assigned=maybe" })).status).toBe(422);
  });

  it("includes the hire, calculated status and what the viewer may do", async () => {
    const { body } = await assign();
    await delegate(body.id);
    const q = await queue(itMember);
    const first = q.data.find((t: any) => t.title === "Create accounts");
    expect(first).toMatchObject({ employee: { id: ids.personas.newHire }, displayStatus: "NOT_STARTED", overdue: true, allowedActions: ["start", "complete"] });
    const blocked = q.data.find((t: any) => t.title === "Provision laptop");
    expect(blocked).toMatchObject({ displayStatus: "BLOCKED", allowedActions: [], dependsOn: { title: "Create accounts" } });
    expect(first.instanceId).toBe(body.id);
  });

  it("orders by due date and hides completed tasks unless asked", async () => {
    const { body } = await assign();
    await db.onboardingTask.update({ where: { id: await taskIdByTitle(body.id, "Create accounts") }, data: { status: "COMPLETED" } });
    const open = await queue(ids.personas.hrAdmin);
    expect(open.total).toBe(4);
    const dues = open.data.map((t: any) => t.dueDate);
    expect(dues).toEqual([...dues].sort());
    expect(titles(await queue(ids.personas.hrAdmin, "?status=COMPLETED"))).toEqual(["Create accounts"]);
  });

  it("filters by calculated status", async () => {
    await assign();
    const hr = ids.personas.hrAdmin;
    expect(titles(await queue(hr, "?status=BLOCKED"))).toEqual(["Grant repo access", "Provision laptop"]);
    expect(titles(await queue(hr, "?status=NOT_STARTED"))).toEqual(["Create accounts", "HR paperwork", "Welcome chat"]);
    expect(titles(await queue(hr, "?status=IN_PROGRESS"))).toEqual([]);
  });

  it("filters by overdue", async () => {
    await assign();
    const hr = ids.personas.hrAdmin;
    expect(titles(await queue(hr, "?overdue=true"))).toEqual(["Create accounts", "HR paperwork", "Provision laptop", "Welcome chat"]);
    expect(titles(await queue(hr, "?overdue=false"))).toEqual(["Grant repo access"]);
  });

  it("paginates and validates", async () => {
    await assign();
    const p = await queue(ids.personas.hrAdmin, "?pageSize=2&page=3");
    expect(p).toMatchObject({ page: 3, pageSize: 2, total: 5 });
    expect(p.data).toHaveLength(1);
    expect((await send(listTasksRoute, ids.personas.hrAdmin, { url: "http://x/api/v1/onboarding/tasks?status=DONE" })).status).toBe(422);
    expect((await send(listTasksRoute, null)).status).toBe(401);
  });
});

describe("POST /onboarding/tasks/:id/transitions", () => {
  it("runs a dependency chain to completion and completes the checklist on the last task", async () => {
    const { body } = await assign();
    await delegate(body.id, { "Provision laptop": itMember2 });
    const id = (t: string) => taskIdByTitle(body.id, t);

    let res = await act(itMember, await id("Create accounts"), "start");
    expect(await json(res)).toMatchObject({ status: "IN_PROGRESS", displayStatus: "IN_PROGRESS", allowedActions: ["complete"], instanceStatus: "ACTIVE" });

    // The next task is blocked until the first is complete.
    res = await act(itMember2, await id("Provision laptop"), "start");
    expect(res.status).toBe(409);
    expect((await json(res)).error.message).toContain("Create accounts");

    res = await act(itMember, await id("Create accounts"), "complete");
    const done = await json(res);
    expect(done).toMatchObject({ status: "COMPLETED", completedBy: { id: itMember }, allowedActions: [] });
    expect(done.completedAt).toBeTruthy();

    // Now Provision laptop can go (its assignee, not the first person), complete it directly from NOT_STARTED.
    expect((await act(itMember2, await id("Provision laptop"), "complete")).status).toBe(200);
    // The head can also work a task themself without assigning it first.
    expect((await act(itHead, await id("Grant repo access"), "complete")).status).toBe(200);
    expect((await act(ids.personas.manager, await id("Welcome chat"), "complete")).status).toBe(200);
    expect((await db.onboardingInstance.findUniqueOrThrow({ where: { id: body.id } })).status).toBe("ACTIVE");

    res = await act(peopleMember, await id("HR paperwork"), "complete");
    expect(await json(res)).toMatchObject({ instanceStatus: "COMPLETED" });
    expect((await db.onboardingInstance.findUniqueOrThrow({ where: { id: body.id } })).status).toBe("COMPLETED");
    // …which ends their new-hire status.
    expect(await db.onboardingInstance.count({ where: { employeeId: ids.personas.newHire, status: "ACTIVE" } })).toBe(0);
  });

  it("rejects people who can see the task but don't own it with 409, and strangers with 404", async () => {
    const { body } = await assign();
    await delegate(body.id);
    const t = await taskIdByTitle(body.id, "Create accounts");
    const welcome = await taskIdByTitle(body.id, "Welcome chat");
    expect((await act(ids.personas.newHire, t, "start")).status).toBe(409); // the hire sees their checklist
    expect((await act(ids.personas.manager, t, "start")).status).toBe(409); // their manager sees it, but IT owns it
    expect((await act(peopleMember, t, "start")).status).toBe(404); // owns other tasks only; not this one
    expect((await act(itMember2, t, "start")).status).toBe(404); // same department as the assignee, but not the assignee
    expect((await act(peopleHead, t, "start")).status).toBe(404); // head of another department
    expect((await act(itMember, welcome, "complete")).status).toBe(404);
    expect((await act(otherManager, welcome, "complete")).status).toBe(404);
    expect((await act(engOutsider, t, "start")).status).toBe(404);
    expect((await act(null, t, "start")).status).toBe(401);
    expect((await db.onboardingTask.findUniqueOrThrow({ where: { id: t } })).status).toBe("NOT_STARTED");
  });

  it("gives HR Admin no override: 409 on every task they were not given, and nothing changes", async () => {
    const { body } = await assign();
    const hr = ids.personas.hrAdmin; // works in People & Culture, but is not its head
    const before = async () => (await db.onboardingTask.findMany({ where: { instanceId: body.id }, orderBy: { sortOrder: "asc" } })).map((t) => t.status);
    const initial = await before();
    for (const title of ["Create accounts", "Welcome chat", "Grant repo access", "HR paperwork"]) {
      for (const action of ["start", "complete"]) {
        const res = await act(hr, await taskIdByTitle(body.id, title), action);
        expect(res.status, `${title}/${action}`).toBe(409);
        expect((await json(res)).error.message).toMatch(/not allowed/);
      }
    }
    expect(await before()).toEqual(initial);
    // Given a task, they work it like anyone assigned.
    expect((await giveTask(hr, await taskIdByTitle(body.id, "HR paperwork"), hr)).status).toBe(200);
    expect((await act(hr, await taskIdByTitle(body.id, "HR paperwork"), "complete")).status).toBe(200);
  });

  it("still lets HR Admin see every task, and offers them only to assign department tasks", async () => {
    const { body } = await assign();
    const hr = ids.personas.hrAdmin;
    const q = await json(await send(listTasksRoute, hr, { url: "http://x/api/v1/onboarding/tasks" }));
    expect(q.total).toBe(5); // full visibility
    const offered = Object.fromEntries(q.data.map((t: any) => [t.title, t.allowedActions]));
    for (const title of ["Create accounts", "Grant repo access", "HR paperwork", "Provision laptop"]) expect(offered[title], title).toEqual(["assign"]);
    expect(offered["Welcome chat"]).toEqual([]);
    const detail = await json(await send(getInstance, hr, { id: body.id }));
    expect(detail.tasks.filter((t: any) => t.allowedActions.length > 0).map((t: any) => t.title).sort()).toEqual(["Create accounts", "Grant repo access", "HR paperwork", "Provision laptop"]);
  });

  it("does not let HR Admin finish a checklist on someone else's behalf", async () => {
    const { body } = await assign();
    await db.onboardingTask.updateMany({ where: { instanceId: body.id, title: { not: "Welcome chat" } }, data: { status: "COMPLETED" } });
    expect((await act(ids.personas.hrAdmin, await taskIdByTitle(body.id, "Welcome chat"), "complete")).status).toBe(409);
    expect((await db.onboardingInstance.findUniqueOrThrow({ where: { id: body.id } })).status).toBe("ACTIVE");
    expect((await act(ids.personas.manager, await taskIdByTitle(body.id, "Welcome chat"), "complete")).status).toBe(200);
    expect((await db.onboardingInstance.findUniqueOrThrow({ where: { id: body.id } })).status).toBe("COMPLETED");
  });

  it("refuses to repeat a transition", async () => {
    const { body } = await assign();
    await delegate(body.id);
    const t = await taskIdByTitle(body.id, "HR paperwork");
    expect((await act(peopleMember, t, "complete")).status).toBe(200);
    expect((await act(peopleMember, t, "complete")).status).toBe(409);
    expect((await act(peopleMember, t, "start")).status).toBe(409);
    const t2 = await taskIdByTitle(body.id, "Create accounts");
    expect((await act(itMember, t2, "start")).status).toBe(200);
    expect((await act(itMember, t2, "start")).status).toBe(409);
  });

  it("validates the body and the id", async () => {
    const { body } = await assign();
    await delegate(body.id);
    const t = await taskIdByTitle(body.id, "Create accounts");
    expect((await act(itMember, t, "reopen")).status).toBe(422);
    expect((await send(postTransition, itMember, { body: { action: "start", extra: 1 }, id: t })).status).toBe(422);
    expect((await act(itMember, "nope", "start")).status).toBe(404);
    expect((await act(itMember, crypto.randomUUID(), "start")).status).toBe(404);
  });

  it("completes the checklist even when the last two tasks finish at the same moment", async () => {
    const { body } = await assign();
    await delegate(body.id);
    const id = (t: string) => taskIdByTitle(body.id, t);
    await db.onboardingTask.updateMany({ where: { instanceId: body.id, title: { notIn: ["Welcome chat", "HR paperwork"] } }, data: { status: "COMPLETED" } });
    const results = await Promise.all([
      act(ids.personas.manager, await id("Welcome chat"), "complete"),
      act(peopleMember, await id("HR paperwork"), "complete"),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect((await db.onboardingInstance.findUniqueOrThrow({ where: { id: body.id } })).status).toBe("COMPLETED");
  });

  it("lets only one of two identical simultaneous requests succeed", async () => {
    const { body } = await assign();
    await delegate(body.id);
    const t = await taskIdByTitle(body.id, "HR paperwork");
    const results = await Promise.all([act(peopleMember, t, "complete"), act(peopleMember, t, "complete")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe("POST /onboarding/tasks/:id/assign", () => {
  const ownerOf = async (taskId: string) => db.onboardingTask.findUniqueOrThrow({ where: { id: taskId } });

  it("lets the head of the owning department assign a task to a member, who can then work it", async () => {
    const { body } = await assign();
    const t = await taskIdByTitle(body.id, "Create accounts");
    expect(await ownerOf(t)).toMatchObject({ assigneeId: null });
    expect((await act(itMember, t, "start")).status).toBe(404); // nothing yet: they can't even see it

    const res = await giveTask(itHead, t, itMember);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ assignee: { id: itMember }, status: "NOT_STARTED", allowedActions: ["start", "complete", "assign"] });
    expect(await ownerOf(t)).toMatchObject({ assigneeId: itMember, status: "NOT_STARTED" });
    expect((await act(itMember, t, "start")).status).toBe(200);
    expect((await act(itMember2, t, "complete")).status).toBe(404);
  });

  it("shows the assignee what they may do, without the assign button", async () => {
    const { body } = await assign();
    const t = await taskIdByTitle(body.id, "Create accounts");
    await giveTask(itHead, t, itMember);
    const q = await json(await send(listTasksRoute, itMember, { url: "http://x/api/v1/onboarding/tasks" }));
    expect(q.data[0]).toMatchObject({ title: "Create accounts", assignee: { id: itMember }, allowedActions: ["start", "complete"] });
  });

  it("lets the head assign a task to themself, and HR Admin assign any department task", async () => {
    const { body } = await assign();
    expect((await giveTask(itHead, await taskIdByTitle(body.id, "Create accounts"), itHead)).status).toBe(200);
    expect((await giveTask(ids.personas.hrAdmin, await taskIdByTitle(body.id, "Provision laptop"), itMember)).status).toBe(200);
    expect((await giveTask(ids.personas.hrAdmin, await taskIdByTitle(body.id, "HR paperwork"), peopleMember)).status).toBe(200);
    expect(await ownerOf(await taskIdByTitle(body.id, "Provision laptop"))).toMatchObject({ assigneeId: itMember });
  });

  it("refuses everyone else: members, the assignee, another department's head, the hire's manager, the hire", async () => {
    const { body } = await assign();
    const t = await taskIdByTitle(body.id, "Create accounts");
    await giveTask(itHead, t, itMember);
    // The assignee, the hire's manager and the hire can see the task, so they get 409; strangers get 404.
    for (const who of [itMember, ids.personas.manager, ids.personas.newHire]) expect((await giveTask(who, t, itMember2)).status).toBe(409);
    for (const who of [itMember2, peopleHead, otherManager]) expect((await giveTask(who, t, itMember2)).status).toBe(404);
    expect((await giveTask(null, t, itMember2)).status).toBe(401);
    expect(await ownerOf(t)).toMatchObject({ assigneeId: itMember }); // unchanged
  });

  it("only accepts an active member of the owning department (422), and refuses a repeat", async () => {
    const { body } = await assign();
    const t = await taskIdByTitle(body.id, "Create accounts");
    for (const bad of [peopleMember, ids.personas.manager, engOutsider]) {
      const res = await giveTask(itHead, t, bad);
      expect(res.status).toBe(422);
      expect((await json(res)).error.details[0].path).toBe("assigneeId");
    }
    expect((await giveTask(itHead, t, crypto.randomUUID())).status).toBe(422);
    const status = async (code: string) => (await db.userStatus.findUniqueOrThrow({ where: { code } })).id;
    await db.user.update({ where: { id: itMember2 }, data: { statusId: await status("ON_NOTICE") } });
    expect((await giveTask(itHead, t, itMember2)).status).toBe(422);
    await db.user.update({ where: { id: itMember2 }, data: { statusId: await status("ACTIVE") } });
    expect((await giveTask(itHead, t, itMember)).status).toBe(200);
    expect((await giveTask(itHead, t, itMember)).status).toBe(422); // already theirs
    expect(await ownerOf(t)).toMatchObject({ assigneeId: itMember });
  });

  it("sends an In Progress task back to Not Started when it goes to someone else", async () => {
    const { body } = await assign();
    const t = await taskIdByTitle(body.id, "Create accounts");
    await giveTask(itHead, t, itMember);
    await act(itMember, t, "start");
    expect(await ownerOf(t)).toMatchObject({ status: "IN_PROGRESS" });
    const res = await giveTask(itHead, t, itMember2);
    expect(await json(res)).toMatchObject({ status: "NOT_STARTED", assignee: { id: itMember2 } });
    expect(await ownerOf(t)).toMatchObject({ status: "NOT_STARTED", assigneeId: itMember2 });
    expect((await act(itMember, t, "complete")).status).toBe(404); // the first person has lost it
  });

  it("works on a blocked task, but not on a completed or manager task", async () => {
    const { body } = await assign();
    expect((await giveTask(itHead, await taskIdByTitle(body.id, "Provision laptop"), itMember)).status).toBe(200); // blocked
    const done = await taskIdByTitle(body.id, "HR paperwork");
    await db.onboardingTask.update({ where: { id: done }, data: { status: "COMPLETED" } });
    expect((await giveTask(ids.personas.hrAdmin, done, peopleMember)).status).toBe(409);
    expect((await giveTask(ids.personas.hrAdmin, await taskIdByTitle(body.id, "Welcome chat"), ids.personas.manager)).status).toBe(409);
    expect((await giveTask(ids.personas.manager, await taskIdByTitle(body.id, "Welcome chat"), ids.personas.manager)).status).toBe(409);
  });

  it("validates the body and the id", async () => {
    const { body } = await assign();
    const t = await taskIdByTitle(body.id, "Create accounts");
    expect((await giveTask(itHead, t, "nope")).status).toBe(422);
    expect((await send(postAssign, itHead, { body: {}, id: t })).status).toBe(422);
    expect((await send(postAssign, itHead, { body: { assigneeId: itMember, extra: 1 }, id: t })).status).toBe(422);
    expect((await giveTask(itHead, "nope", itMember)).status).toBe(404);
    expect((await giveTask(itHead, crypto.randomUUID(), itMember)).status).toBe(404);
  });

  it("applies two simultaneous assignments one after the other, ending on one of them", async () => {
    const { body } = await assign();
    const t = await taskIdByTitle(body.id, "Create accounts");
    const results = await Promise.all([giveTask(itHead, t, itMember), giveTask(itHead, t, itMember2)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect([itMember, itMember2]).toContain((await ownerOf(t)).assigneeId);
  });
});
