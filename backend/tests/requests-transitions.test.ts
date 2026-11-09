import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as transitionRoute } from "../app/api/v1/requests/[id]/transitions/route";
import { clearAll, seedBase } from "../prisma/seed/base";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { db } from "./db";

let ids: Awaited<ReturnType<typeof seedBase>>;
let itHead: string;
let itWorker: string; // IT Ops member who can be assigned
let itWorker2: string;
let onNotice: string;
let engMember: string; // not in IT Ops
let requestId: string;

beforeAll(async () => {
  await clearAll(db);
  ids = await seedBase(db, await bcrypt.hash("x", 4));
  const it = await db.department.findUniqueOrThrow({ where: { code: "ITOPS" } });
  itHead = it.headId!;
  const members = await db.user.findMany({ where: { departmentId: it.id, role: { code: "EMPLOYEE" }, status: { code: "ACTIVE" } }, orderBy: { employeeCode: "asc" } });
  itWorker = members[0].id;
  itWorker2 = members[1].id;
  await db.user.update({ where: { id: members[2].id }, data: { status: { connect: { code: "ON_NOTICE" } } } });
  onNotice = members[2].id;
  engMember = (await db.user.findFirstOrThrow({ where: { department: { code: "ENG" }, role: { code: "EMPLOYEE" }, status: { code: "ACTIVE" } } })).id;
});
afterAll(() => db.$disconnect());

// A fresh SUBMITTED IT request from the new-hire persona before every test.
beforeEach(async () => {
  const cat = await db.requestCategory.findUniqueOrThrow({ where: { code: "IT_EQUIPMENT" } });
  const r = await db.serviceRequest.create({
    data: { requesterId: ids.personas.newHire, categoryId: cat.id, handlingDepartmentId: cat.handlingDepartmentId, title: "Laptop", description: "d", priority: "MEDIUM" },
  });
  await db.requestEvent.create({ data: { requestId: r.id, toStatus: "SUBMITTED", actorId: ids.personas.newHire } });
  requestId = r.id;
});

const json = async (res: Response) => (await res.json()) as any;
async function act(userId: string | null, action: string, extra: Record<string, unknown> = {}, id = requestId) {
  return transitionRoute(
    new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/json", ...(userId && { cookie: `${SESSION_COOKIE}=${await signSession(userId)}` }) },
      body: JSON.stringify({ action, ...extra }),
    }),
    { params: Promise.resolve({ id }) },
  );
}
const statusOf = async () => (await db.serviceRequest.findUniqueOrThrow({ where: { id: requestId } })).status;
const eventCount = () => db.requestEvent.count({ where: { requestId } });

describe("full lifecycle", () => {
  it("Submitted → Assigned → In Progress → Resolved → Closed for the right people", async () => {
    let res = await act(itHead, "assign", { assigneeId: itWorker, note: "Please handle" });
    let body = await json(res);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: "ASSIGNED", assignee: { id: itWorker }, allowedActions: ["assign"] });

    res = await act(itWorker, "start");
    body = await json(res);
    expect(body).toMatchObject({ status: "IN_PROGRESS", assignee: { id: itWorker }, allowedActions: ["resolve"] });

    res = await act(itWorker, "resolve", { note: "Replaced the laptop" });
    expect(await json(res)).toMatchObject({ status: "RESOLVED", allowedActions: [] });

    res = await act(ids.personas.newHire, "close");
    body = await json(res);
    expect(body).toMatchObject({ status: "CLOSED", allowedActions: [] });

    // History: one row per change, in order, with who/what/note.
    expect(body.events.map((e: any) => `${e.fromStatus ?? "-"}>${e.toStatus}`)).toEqual([
      "->SUBMITTED", "SUBMITTED>ASSIGNED", "ASSIGNED>IN_PROGRESS", "IN_PROGRESS>RESOLVED", "RESOLVED>CLOSED",
    ]);
    expect(body.events[1]).toMatchObject({ actor: { id: itHead }, assignee: { id: itWorker }, note: "Please handle" });
    expect(body.events[3]).toMatchObject({ actor: { id: itWorker }, note: "Replaced the laptop" });
  });

  it("lets HR Admin assign and close", async () => {
    expect((await act(ids.personas.hrAdmin, "assign", { assigneeId: itWorker })).status).toBe(200);
    await act(itWorker, "start");
    await act(itWorker, "resolve");
    expect((await act(ids.personas.hrAdmin, "close")).status).toBe(200);
    expect(await statusOf()).toBe("CLOSED");
  });

  it("supports reassignment while Assigned, recording each change", async () => {
    await act(itHead, "assign", { assigneeId: itWorker });
    const res = await act(itHead, "assign", { assigneeId: itWorker2 });
    expect(await json(res)).toMatchObject({ status: "ASSIGNED", assignee: { id: itWorker2 } });
    expect(await eventCount()).toBe(3);
  });
});

describe("rejections write nothing", () => {
  const unchanged = async (fn: () => Promise<Response>, expectedStatus: number) => {
    const before = await eventCount();
    const status = await statusOf();
    expect((await fn()).status).toBe(expectedStatus);
    expect(await eventCount()).toBe(before);
    expect(await statusOf()).toBe(status);
  };

  it("409 for an action the current status doesn't allow", async () => {
    // Everyone here can see the request; the status just doesn't allow the action.
    await unchanged(() => act(itHead, "start"), 409);
    await unchanged(() => act(itHead, "resolve"), 409);
    await unchanged(() => act(ids.personas.newHire, "close"), 409);
    await unchanged(() => act(ids.personas.hrAdmin, "close"), 409);
  });

  it("409 when the person isn't allowed to do it", async () => {
    await unchanged(() => act(ids.personas.newHire, "assign", { assigneeId: itWorker }), 409); // requester
    await unchanged(() => act(ids.personas.manager, "assign", { assigneeId: itWorker }), 409); // requester's manager
    await act(itHead, "assign", { assigneeId: itWorker });
    await unchanged(() => act(itHead, "start"), 409); // head can see it but is not the assignee
    await unchanged(() => act(ids.personas.hrAdmin, "start"), 409); // no HR override
    await unchanged(() => act(ids.personas.newHire, "start"), 409); // the requester
    await unchanged(() => act(itWorker2, "start"), 404); // IT colleague: cannot even see it
  });

  it("409 for a head of another department", async () => {
    const opsHead = (await db.department.findUniqueOrThrow({ where: { code: "OPS" } })).headId!;
    // Not in scope at all (not their dept, not their report) → hidden as 404.
    await unchanged(() => act(opsHead, "assign", { assigneeId: itWorker }), 404);
  });

  it("404 outside scope, including malformed and unknown ids; 401 without login", async () => {
    await unchanged(() => act(engMember, "assign", { assigneeId: itWorker }), 404);
    expect((await act(itHead, "assign", { assigneeId: itWorker }, crypto.randomUUID())).status).toBe(404);
    expect((await act(itHead, "assign", { assigneeId: itWorker }, "nope")).status).toBe(404);
    expect((await act(null, "start")).status).toBe(401);
  });

  it("422 for a missing, foreign, on-notice or unknown assignee", async () => {
    await unchanged(() => act(itHead, "assign"), 422);
    await unchanged(() => act(itHead, "assign", { assigneeId: engMember }), 422);
    await unchanged(() => act(itHead, "assign", { assigneeId: onNotice }), 422);
    await unchanged(() => act(itHead, "assign", { assigneeId: crypto.randomUUID() }), 422);
  });

  it("422 for bad bodies: unknown action, stray assigneeId, blank note, extra fields", async () => {
    await unchanged(() => act(itHead, "delete"), 422);
    await act(itHead, "assign", { assigneeId: itWorker });
    await unchanged(() => act(itWorker, "start", { assigneeId: itWorker2 }), 422);
    await unchanged(() => act(itWorker, "start", { note: "   " }), 422);
    await unchanged(() => act(itWorker, "start", { status: "CLOSED" }), 422);
  });

  it("explains the 409 with the standard error code", async () => {
    const body = await json(await act(itHead, "start"));
    expect(body.error.code).toBe("INVALID_TRANSITION");
  });
});

describe("reassigning a request that is in progress", () => {
  const started = async () => {
    await act(itHead, "assign", { assigneeId: itWorker });
    await act(itWorker, "start");
  };

  it("lets the department's Manager hand it to someone else; it returns to Assigned and the new person starts it", async () => {
    await started();
    expect(await statusOf()).toBe("IN_PROGRESS");

    const res = await act(itHead, "assign", { assigneeId: itWorker2, note: "Moving to Daniel, Jun Hao is on leave" });
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: "ASSIGNED", assignee: { id: itWorker2 } });
    const last = body.events.at(-1);
    expect(last).toMatchObject({ fromStatus: "IN_PROGRESS", toStatus: "ASSIGNED", assignee: { id: itWorker2 }, note: "Moving to Daniel, Jun Hao is on leave" });

    // The previous assignee can no longer see or act on it (it is not theirs any more); the new one can.
    expect((await act(itWorker, "resolve")).status).toBe(404);
    expect((await act(itWorker2, "start")).status).toBe(200);
    expect(await statusOf()).toBe("IN_PROGRESS");
  });

  it("lets HR Admin do it too, but not the assignee, the requester or an unrelated person", async () => {
    await started();
    for (const who of [itWorker, ids.personas.newHire, engMember]) {
      const res = await act(who, "assign", { assigneeId: itWorker2 });
      expect([403, 404, 409]).toContain(res.status);
      expect(await statusOf()).toBe("IN_PROGRESS");
    }
    expect((await act(ids.personas.hrAdmin, "assign", { assigneeId: itWorker2 })).status).toBe(200);
    expect(await statusOf()).toBe("ASSIGNED");
  });

  it("rejects handing it to the person already working on it, or to someone outside the department", async () => {
    await started();
    expect((await act(itHead, "assign", { assigneeId: itWorker })).status).toBe(422);
    expect((await act(itHead, "assign", { assigneeId: engMember })).status).toBe(422);
    expect((await act(itHead, "assign", { assigneeId: onNotice })).status).toBe(422);
    expect(await statusOf()).toBe("IN_PROGRESS");
  });

  it("is still not possible once the request is resolved or closed", async () => {
    await started();
    await act(itWorker, "resolve");
    expect((await act(itHead, "assign", { assigneeId: itWorker2 })).status).toBe(409);
    await act(ids.personas.newHire, "close");
    expect((await act(itHead, "assign", { assigneeId: itWorker2 })).status).toBe(409);
  });
});

describe("concurrency", () => {
  it("lets only one of two simultaneous identical actions succeed", async () => {
    await act(itHead, "assign", { assigneeId: itWorker });
    const results = await Promise.all([act(itWorker, "start"), act(itWorker, "start")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await statusOf()).toBe("IN_PROGRESS");
    const starts = await db.requestEvent.count({ where: { requestId, toStatus: "IN_PROGRESS" } });
    expect(starts).toBe(1);
  });

  it("never leaves an assigned-status request without an assignee (database CHECK stays satisfied)", async () => {
    await act(itHead, "assign", { assigneeId: itWorker });
    const bad = await db.serviceRequest.count({ where: { status: { not: "SUBMITTED" }, assigneeId: null } });
    expect(bad).toBe(0);
  });
});
