import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getDetail } from "../app/api/v1/requests/[id]/route";
import { POST as postComment } from "../app/api/v1/requests/[id]/comments/route";
import { GET as listRoute, POST as createRoute } from "../app/api/v1/requests/route";
import { clearAll, seedBase } from "../prisma/seed/base";
import { PERSONA_EMAILS } from "../prisma/seed/data";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { db } from "./db";

let ids: Awaited<ReturnType<typeof seedBase>>;
let cat: Record<string, string>;
let itHeadId: string;
let opsHeadId: string;
let strangerId: string; // an Engineering employee unrelated to the personas' requests

beforeAll(async () => {
  await clearAll(db);
  ids = await seedBase(db, await bcrypt.hash("x", 4));
  cat = Object.fromEntries((await db.requestCategory.findMany()).map((c) => [c.code, c.id]));
  const depts = await db.department.findMany();
  itHeadId = depts.find((d) => d.code === "ITOPS")!.headId!;
  opsHeadId = depts.find((d) => d.code === "OPS")!.headId!;
  strangerId = (await db.user.findFirstOrThrow({ where: { department: { code: "FIN" }, role: "EMPLOYEE" } })).id;
});
afterAll(() => db.$disconnect());

const cookie = async (userId: string | null) => (userId ? { cookie: `${SESSION_COOKIE}=${await signSession(userId)}` } : {});
const json = async (res: Response) => (await res.json()) as any;

async function create(userId: string | null, body: unknown) {
  return createRoute(
    new Request("http://x/api/v1/requests", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await cookie(userId)) },
      body: JSON.stringify(body),
    }),
  );
}
const list = async (userId: string | null, qs = "") =>
  listRoute(new Request(`http://x/api/v1/requests${qs}`, { headers: await cookie(userId) }));
const detail = async (userId: string | null, id: string) =>
  getDetail(new Request("http://x", { headers: await cookie(userId) }), { params: Promise.resolve({ id }) });
const comment = async (userId: string | null, id: string, body: unknown) =>
  postComment(
    new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...(await cookie(userId)) }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

const payload = (over: Record<string, unknown> = {}) => ({
  categoryId: cat.IT_EQUIPMENT,
  title: "New laptop",
  description: "My laptop is slow.",
  priority: "HIGH",
  ...over,
});

describe("POST /requests", () => {
  it("requires login", async () => {
    expect((await create(null, payload())).status).toBe(401);
  });

  it("creates a SUBMITTED request routed to the category's department, for every role", async () => {
    for (const userId of [ids.personas.newHire, ids.personas.manager, ids.personas.hrAdmin]) {
      const res = await create(userId, payload());
      const body = await json(res);
      expect(res.status).toBe(201);
      expect(body).toMatchObject({
        status: "SUBMITTED", title: "New laptop", priority: "HIGH", assignee: null,
        category: { code: "IT_EQUIPMENT" }, handlingDepartment: { code: "ITOPS" }, requester: { id: userId },
      });
      expect(body.reference).toMatch(/^SR-\d+$/);
    }
  });

  it("numbers references sequentially", async () => {
    const a = await json(await create(strangerId, payload()));
    const b = await json(await create(strangerId, payload()));
    expect(Number(b.reference.slice(3))).toBe(Number(a.reference.slice(3)) + 1);
  });

  it("writes the first history row in the same transaction", async () => {
    const body = await json(await create(ids.personas.newHire, payload({ title: "History check" })));
    const events = await db.requestEvent.findMany({ where: { requestId: body.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: null, toStatus: "SUBMITTED", actorId: ids.personas.newHire });
  });

  it("trims text and routes other categories correctly", async () => {
    const body = await json(await create(strangerId, payload({ categoryId: cat.FACILITIES, title: "  Broken desk  " })));
    expect(body.title).toBe("Broken desk");
    expect(body.handlingDepartment.code).toBe("OPS");
    expect((await json(await create(strangerId, payload({ categoryId: cat.HR_QUERY })))).handlingDepartment.code).toBe("PEOPLE");
  });

  describe("channel (how it was raised)", () => {
    it("defaults to FORM and stores CHAT when the chat assistant sends it", async () => {
      const form = await json(await create(strangerId, payload()));
      const chat = await json(await create(strangerId, payload({ channel: "CHAT" })));
      expect(form.channel).toBe("FORM");
      expect(chat.channel).toBe("CHAT");
      expect((await db.serviceRequest.findUniqueOrThrow({ where: { id: chat.id } })).channel).toBe("CHAT");
      expect((await db.serviceRequest.findUniqueOrThrow({ where: { id: form.id } })).channel).toBe("FORM");
    });

    it("rejects any other value, and stores nothing", async () => {
      const before = await db.serviceRequest.count();
      expect((await create(strangerId, payload({ channel: "EMAIL" }))).status).toBe(422);
      expect((await create(strangerId, payload({ channel: "chat" }))).status).toBe(422);
      expect((await create(strangerId, payload({ channel: null }))).status).toBe(422);
      expect(await db.serviceRequest.count()).toBe(before);
    });

    it("changes neither the routing nor who can see the request", async () => {
      const body = await json(await create(strangerId, payload({ channel: "CHAT" })));
      expect(body.handlingDepartment.code).toBe("ITOPS");
      expect((await detail(itHeadId, body.id)).status).toBe(200);
      expect((await detail(opsHeadId, body.id)).status).toBe(404);
    });

    it("is part of every request in a list and in the detail", async () => {
      const chat = await json(await create(strangerId, payload({ channel: "CHAT" })));
      const rows = (await json(await list(strangerId, "?pageSize=100"))).data;
      expect(rows.find((r: any) => r.id === chat.id).channel).toBe("CHAT");
      expect((await json(await detail(strangerId, chat.id))).channel).toBe("CHAT");
    });
  });

  describe("choosing the department", () => {
    let opsDeptId: string;
    beforeAll(async () => {
      opsDeptId = (await db.department.findUniqueOrThrow({ where: { code: "OPS" } })).id;
    });

    it("sends the request to the chosen department instead of the category's, and keeps the category", async () => {
      const res = await create(strangerId, payload({ handlingDepartmentId: opsDeptId }));
      const body = await json(res);
      expect(res.status).toBe(201);
      expect(body).toMatchObject({ category: { code: "IT_EQUIPMENT" }, handlingDepartment: { code: "OPS" } });
      expect((await db.serviceRequest.findUniqueOrThrow({ where: { id: body.id } })).handlingDepartmentId).toBe(opsDeptId);
    });

    it("uses the category's department when none is chosen", async () => {
      const body = await json(await create(strangerId, payload()));
      expect(body.handlingDepartment.code).toBe("ITOPS");
    });

    it("accepts the category's own department explicitly", async () => {
      const itDeptId = (await db.department.findUniqueOrThrow({ where: { code: "ITOPS" } })).id;
      expect((await json(await create(strangerId, payload({ handlingDepartmentId: itDeptId })))).handlingDepartment.code).toBe("ITOPS");
    });

    it("puts it in the chosen department's Manager's view, and not in the category's department's", async () => {
      const body = await json(await create(strangerId, payload({ title: "Sent to Operations", handlingDepartmentId: opsDeptId })));
      expect((await detail(opsHeadId, body.id)).status).toBe(200);
      expect((await detail(itHeadId, body.id)).status).toBe(404);
      const queue = await json(await list(opsHeadId, "?pageSize=100"));
      expect(queue.data.map((r: any) => r.id)).toContain(body.id);
    });

    it("lets every role choose a department", async () => {
      for (const userId of [ids.personas.newHire, ids.personas.manager, ids.personas.hrAdmin]) {
        expect((await create(userId, payload({ handlingDepartmentId: opsDeptId }))).status).toBe(201);
      }
    });

    it("explains an unknown department with the field name", async () => {
      const body = await json(await create(strangerId, payload({ handlingDepartmentId: crypto.randomUUID() })));
      expect(body.error.code).toBe("VALIDATION_FAILED");
      expect(body.error.details).toEqual([{ path: "handlingDepartmentId", message: "Department not found" }]);
    });
  });

  it.each([
    ["unknown category", { categoryId: crypto.randomUUID() }],
    ["non-uuid category", { categoryId: "abc" }],
    ["blank title", { title: "   " }],
    ["overlong title", { title: "x".repeat(201) }],
    ["blank description", { description: "" }],
    ["bad priority", { priority: "CRITICAL" }],
    ["client-supplied status", { status: "CLOSED" }],
    ["client-supplied requester", { requesterId: crypto.randomUUID() }],
    ["unknown department", { handlingDepartmentId: crypto.randomUUID() }],
    ["non-uuid department", { handlingDepartmentId: "abc" }],
    ["null department", { handlingDepartmentId: null }],
  ])("returns 422 for %s and stores nothing", async (_n, over) => {
    const before = await db.serviceRequest.count();
    expect((await create(strangerId, payload(over))).status).toBe(422);
    expect(await db.serviceRequest.count()).toBe(before);
  });
});

describe("GET /requests?mine&channel (the chat's earlier requests)", () => {
  let mgr: string;
  let hr: string;
  let emp: string;
  const mk = async (who: string, title: string, channel: "FORM" | "CHAT") => json(await create(who, payload({ title, channel })));

  beforeAll(async () => {
    mgr = ids.personas.manager;
    hr = ids.personas.hrAdmin;
    emp = ids.personas.newHire;
    await db.serviceRequest.deleteMany({ where: { title: { startsWith: "mine:" } } });
    await mk(emp, "mine: emp chat 1", "CHAT");
    await mk(emp, "mine: emp form", "FORM");
    await mk(emp, "mine: emp chat 2", "CHAT");
    await mk(mgr, "mine: mgr chat", "CHAT");
    await mk(mgr, "mine: mgr form", "FORM");
    await mk(hr, "mine: hr chat", "CHAT");
    // A report's chat request: a Manager sees it in the normal list, but it is not theirs.
    const report = await db.user.findFirstOrThrow({ where: { managerId: mgr, role: "EMPLOYEE" } });
    await mk(report.id, "mine: report chat", "CHAT");
  });

  const titles = async (who: string, qs: string) =>
    (await json(await list(who, `?pageSize=100&${qs}`))).data.map((r: any) => r.title).filter((t: string) => t.startsWith("mine:"));

  it("returns only the caller's own chat requests, newest first", async () => {
    expect(await titles(emp, "mine=true&channel=CHAT")).toEqual(["mine: emp chat 2", "mine: emp chat 1"]);
  });

  it("does not include form requests unless asked", async () => {
    expect(await titles(emp, "mine=true&channel=FORM")).toEqual(["mine: emp form"]);
    expect((await titles(emp, "mine=true")).sort()).toEqual(["mine: emp chat 1", "mine: emp chat 2", "mine: emp form"]);
  });

  it("is also 'mine' for a Manager and an HR Admin, who otherwise see more", async () => {
    expect(await titles(mgr, "mine=true&channel=CHAT")).toEqual(["mine: mgr chat"]);
    expect(await titles(hr, "mine=true&channel=CHAT")).toEqual(["mine: hr chat"]);
    // without mine, the Manager still sees their report's request and HR sees everyone's: scope is unchanged
    expect(await titles(mgr, "channel=CHAT")).toContain("mine: report chat");
    expect(await titles(hr, "channel=CHAT")).toEqual(expect.arrayContaining(["mine: emp chat 1", "mine: mgr chat", "mine: hr chat", "mine: report chat"]));
  });

  it("mine=false is the same as leaving it out; other values and channels are 422", async () => {
    expect((await titles(mgr, "mine=false&channel=CHAT")).length).toBeGreaterThan(1);
    expect((await list(mgr, "?mine=yes")).status).toBe(422);
    expect((await list(mgr, "?channel=EMAIL")).status).toBe(422);
  });

  it("pages and counts the filtered list", async () => {
    const body = await json(await list(emp, "?mine=true&channel=CHAT&pageSize=1&page=2"));
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.data).toHaveLength(1);
  });
});

describe("GET /requests (scope, filters, paging)", () => {
  let r: Record<string, string>;

  beforeAll(async () => {
    await clearAll(db);
    ids = await seedBase(db, await bcrypt.hash("x", 4));
    cat = Object.fromEntries((await db.requestCategory.findMany()).map((c) => [c.code, c.id]));
    const depts = await db.department.findMany();
    itHeadId = depts.find((d) => d.code === "ITOPS")!.headId!;
    opsHeadId = depts.find((d) => d.code === "OPS")!.headId!;
    strangerId = (await db.user.findFirstOrThrow({ where: { department: { code: "FIN" }, role: "EMPLOYEE" } })).id;
    // newHire (reports to manager) → IT; stranger → IT; stranger → Facilities (Ops)
    r = {
      hire: (await json(await create(ids.personas.newHire, payload({ title: "Hire IT", priority: "URGENT" })))).id,
      stranger: (await json(await create(strangerId, payload({ title: "Stranger IT" })))).id,
      facilities: (await json(await create(strangerId, payload({ categoryId: cat.FACILITIES, title: "Stranger desk", priority: "LOW" })))).id,
    };
    // assign the hire's request to it.support so the "assigned to me" path is covered
    await db.serviceRequest.update({ where: { id: r.hire }, data: { status: "ASSIGNED", assigneeId: ids.personas.itSupport } });
  });

  const idsOf = async (userId: string, qs = "") => (await json(await list(userId, qs))).data.map((x: any) => x.id).sort();
  const sorted = (...xs: string[]) => xs.sort();

  it("requires login", async () => {
    expect((await list(null)).status).toBe(401);
  });

  it("HR Admin sees all requests, newest first, in the list envelope", async () => {
    const body = await json(await list(ids.personas.hrAdmin));
    expect(body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(body.data.map((x: any) => x.id)).toEqual([r.facilities, r.stranger, r.hire]);
  });

  it("an Employee sees only what they submitted", async () => {
    expect(await idsOf(strangerId)).toEqual(sorted(r.stranger, r.facilities));
    expect(await idsOf(ids.personas.newHire)).toEqual([r.hire]);
  });

  it("the assignee sees the request assigned to them, but not the rest of the queue", async () => {
    expect(await idsOf(ids.personas.itSupport)).toEqual([r.hire]);
  });

  it("a Manager sees direct reports' requests", async () => {
    expect(await idsOf(ids.personas.manager)).toEqual([r.hire]);
  });

  it("a department head sees the queue for their department only", async () => {
    expect(await idsOf(itHeadId)).toEqual(sorted(r.hire, r.stranger));
    expect(await idsOf(opsHeadId)).toEqual([r.facilities]);
  });

  it("filters by status, category, priority and requester country, within scope", async () => {
    const hr = ids.personas.hrAdmin;
    expect(await idsOf(hr, "?status=ASSIGNED")).toEqual([r.hire]);
    expect(await idsOf(hr, `?categoryId=${cat.FACILITIES}`)).toEqual([r.facilities]);
    expect(await idsOf(hr, "?priority=URGENT")).toEqual([r.hire]);
    const hireCountry = (await db.user.findUniqueOrThrow({ where: { id: ids.personas.newHire } })).country;
    expect(await idsOf(hr, `?country=${hireCountry}`)).toContain(r.hire);
    // A filter never widens scope: the stranger cannot pull in the hire's request.
    expect(await idsOf(strangerId, `?priority=URGENT`)).toEqual([]);
    expect(await idsOf(strangerId, `?country=${hireCountry}&status=ASSIGNED`)).toEqual([]);
  });

  it("paginates", async () => {
    const p1 = await json(await list(ids.personas.hrAdmin, "?pageSize=2&page=1"));
    const p2 = await json(await list(ids.personas.hrAdmin, "?pageSize=2&page=2"));
    expect(p1).toMatchObject({ pageSize: 2, total: 3 });
    expect(p1.data).toHaveLength(2);
    expect(p2.data).toHaveLength(1);
  });

  it("treats empty filters as absent and rejects invalid ones with 422", async () => {
    expect((await json(await list(ids.personas.hrAdmin, "?status=&country="))).total).toBe(3);
    expect((await list(ids.personas.hrAdmin, "?status=DONE")).status).toBe(422);
    expect((await list(ids.personas.hrAdmin, "?categoryId=x")).status).toBe(422);
  });

  describe("GET /requests/:id", () => {
    it("returns detail with events, comments and allowedActions", async () => {
      const res = await detail(ids.personas.newHire, r.hire);
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ id: r.hire, description: "My laptop is slow.", comments: [], allowedActions: [] });
      expect(body.events).toHaveLength(1);
      expect(body.events[0]).toMatchObject({ fromStatus: null, toStatus: "SUBMITTED", actor: { id: ids.personas.newHire } });
    });

    it("tailors allowedActions to the viewer", async () => {
      expect((await json(await detail(itHeadId, r.stranger))).allowedActions).toEqual(["assign"]);
      expect((await json(await detail(ids.personas.hrAdmin, r.hire))).allowedActions).toEqual(["assign"]);
      expect((await json(await detail(ids.personas.itSupport, r.hire))).allowedActions).toEqual(["start"]);
      expect((await json(await detail(strangerId, r.stranger))).allowedActions).toEqual([]);
    });

    it("returns 404, not 403, outside scope, and for malformed or unknown ids", async () => {
      expect((await detail(strangerId, r.hire)).status).toBe(404);
      expect((await detail(opsHeadId, r.hire)).status).toBe(404);
      expect((await detail(ids.personas.hrAdmin, crypto.randomUUID())).status).toBe(404);
      expect((await detail(ids.personas.hrAdmin, "not-a-uuid")).status).toBe(404);
      expect((await detail(null, r.hire)).status).toBe(401);
    });
  });

  describe("POST /requests/:id/comments", () => {
    it("adds a comment with server-set author and time, visible to everyone who can see the request", async () => {
      const res = await comment(ids.personas.manager, r.hire, { body: "  Any update?  " });
      const c = await json(res);
      expect(res.status).toBe(201);
      expect(c).toMatchObject({ body: "Any update?", author: { id: ids.personas.manager } });
      expect(new Date(c.createdAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
      const seenByHire = await json(await detail(ids.personas.newHire, r.hire));
      expect(seenByHire.comments.map((x: any) => x.body)).toEqual(["Any update?"]);
    });

    it("lists comments oldest first", async () => {
      await comment(ids.personas.itSupport, r.hire, { body: "On it" });
      const d = await json(await detail(ids.personas.hrAdmin, r.hire));
      expect(d.comments.map((x: any) => x.body)).toEqual(["Any update?", "On it"]);
    });

    it("returns 404 for requests the user cannot see and stores nothing", async () => {
      const before = await db.requestComment.count();
      expect((await comment(strangerId, r.hire, { body: "sneaky" })).status).toBe(404);
      expect(await db.requestComment.count()).toBe(before);
    });

    it("rejects blank bodies and client-supplied authors with 422", async () => {
      expect((await comment(ids.personas.manager, r.hire, { body: "   " })).status).toBe(422);
      expect((await comment(ids.personas.manager, r.hire, { body: "x", authorId: ids.personas.hrAdmin })).status).toBe(422);
    });

    it("requires login", async () => {
      expect((await comment(null, r.hire, { body: "x" })).status).toBe(401);
    });
  });
});
