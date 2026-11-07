import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAuthUser } from "@/lib/auth";
import { scopeRequests, scopeUsers } from "@/services/policy";
import { db, makeDepartment, makeUser, resetDb } from "./db";

/**
 * Evaluates the scope against real rows, so the test proves what each role can actually see,
 * not just what shape the `where` clause has.
 */
let ids: Record<string, string>;
let reqs: Record<string, string>;

beforeAll(async () => {
  await resetDb();
  const it = await makeDepartment("IT");
  const ops = await makeDepartment("Ops");
  const hr = await makeUser(it.id, { role: "HR_ADMIN" });
  const itHead = await makeUser(it.id, { role: "MANAGER" });
  const opsHead = await makeUser(ops.id, { role: "MANAGER" });
  await db.department.update({ where: { id: it.id }, data: { headId: itHead.id } });
  await db.department.update({ where: { id: ops.id }, data: { headId: opsHead.id } });
  const teamLead = await makeUser(ops.id, { role: "MANAGER" }); // manager, heads no department
  const reporter = await makeUser(ops.id, { managerId: teamLead.id }); // teamLead's direct report
  const worker = await makeUser(it.id, { managerId: itHead.id }); // IT employee
  const other = await makeUser(ops.id, { managerId: opsHead.id }); // unrelated
  const stranger = await makeUser(ops.id, { managerId: opsHead.id });

  const cat = (code: "IT_EQUIPMENT" | "FACILITIES", dept: string) =>
    db.requestCategory.create({ data: { code, name: code, handlingDepartmentId: dept } });
  const itCat = await cat("IT_EQUIPMENT", it.id);
  const opsCat = await cat("FACILITIES", ops.id);
  const mk = (requesterId: string, c: typeof itCat, dept: string, extra: object = {}) =>
    db.serviceRequest.create({
      data: { requesterId, categoryId: c.id, handlingDepartmentId: dept, title: "t", description: "d", priority: "LOW", ...extra },
    });

  // R1: reporter → IT, assigned to worker.  R2: other → IT, unassigned.  R3: other → Ops.
  const r1 = await mk(reporter.id, itCat, it.id, { status: "ASSIGNED", assigneeId: worker.id });
  const r2 = await mk(other.id, itCat, it.id);
  const r3 = await mk(other.id, opsCat, ops.id);

  ids = { hr: hr.id, itHead: itHead.id, opsHead: opsHead.id, teamLead: teamLead.id, reporter: reporter.id, worker: worker.id, other: other.id, stranger: stranger.id };
  reqs = { r1: r1.id, r2: r2.id, r3: r3.id };
});
afterAll(() => db.$disconnect());

const visible = async (userId: string) => {
  const user = (await loadAuthUser(userId))!;
  const rows = await db.serviceRequest.findMany({ where: scopeRequests(user), select: { id: true } });
  const byId = Object.fromEntries(Object.entries(reqs).map(([k, v]) => [v, k]));
  return rows.map((r) => byId[r.id]).sort();
};

describe("scopeRequests", () => {
  it("HR Admin sees every request", async () => {
    expect(await visible(ids.hr)).toEqual(["r1", "r2", "r3"]);
  });

  it("an Employee sees requests they submitted", async () => {
    expect(await visible(ids.reporter)).toEqual(["r1"]);
    expect(await visible(ids.other)).toEqual(["r2", "r3"]);
  });

  it("an Employee sees requests assigned to them, but not the rest of the queue", async () => {
    expect(await visible(ids.worker)).toEqual(["r1"]);
  });

  it("an Employee with no involvement sees nothing", async () => {
    expect(await visible(ids.stranger)).toEqual([]);
  });

  it("a Manager sees their direct reports' requests", async () => {
    expect(await visible(ids.teamLead)).toEqual(["r1"]);
  });

  it("a department head sees their department's whole queue, and no other department's", async () => {
    // r2's requester is not the IT head's report, so r2 is visible only through the IT queue clause.
    expect(await visible(ids.itHead)).toEqual(["r1", "r2"]);
    // Ops head: r3 via the Ops queue; r2 because its requester reports to them; never r1 (IT, not their report).
    expect(await visible(ids.opsHead)).toEqual(["r2", "r3"]);
  });

  it("a Manager who heads nothing gets no department-queue access", async () => {
    // teamLead is a Manager but not a head: only the direct report's request, not the Ops queue.
    expect(await visible(ids.teamLead)).not.toContain("r3");
  });

  it("returns an empty (match-all) clause only for HR Admin", async () => {
    const hr = (await loadAuthUser(ids.hr))!;
    const emp = (await loadAuthUser(ids.worker))!;
    expect(scopeRequests(hr)).toEqual({});
    expect(scopeRequests(emp)).not.toEqual({});
  });
});

describe("scopeUsers", () => {
  const visibleUsers = async (userId: string) => {
    const user = (await loadAuthUser(userId))!;
    return (await db.user.findMany({ where: scopeUsers(user), select: { id: true } })).map((u) => u.id).sort();
  };

  it("HR sees everyone; a Manager their direct reports; an Employee only themselves", async () => {
    expect(await visibleUsers(ids.hr)).toHaveLength(8);
    expect(await visibleUsers(ids.teamLead)).toEqual([ids.reporter]);
    expect(await visibleUsers(ids.worker)).toEqual([ids.worker]);
  });
});
