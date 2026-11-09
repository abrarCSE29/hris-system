import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearAll, seedBase } from "../prisma/seed/base";
import { seedRequests } from "../prisma/seed/requests";
import { db } from "./db";

let base: Awaited<ReturnType<typeof seedBase>>;

beforeAll(async () => {
  await clearAll(db);
  base = await seedBase(db, await bcrypt.hash("x", 4));
  await seedRequests(db, base);
});
afterAll(() => db.$disconnect());

const counts = async (field: "status" | "priority" | "categoryId") =>
  Object.fromEntries((await db.serviceRequest.groupBy({ by: [field], _count: true })).map((g) => [g[field], g._count]));

describe("request seed", () => {
  it("creates 35 requests numbered SR-1001…SR-1035, oldest first", async () => {
    const rows = await db.serviceRequest.findMany({ orderBy: { reference: "asc" } });
    expect(rows).toHaveLength(35);
    expect(rows.map((r) => r.reference)).toEqual(Array.from({ length: 35 }, (_, i) => `SR-${1001 + i}`));
    const times = rows.map((r) => r.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("covers all 5 categories, 5 statuses and 4 priorities", async () => {
    expect(Object.keys(await counts("categoryId"))).toHaveLength(5);
    expect(await counts("status")).toEqual({ SUBMITTED: 7, ASSIGNED: 7, IN_PROGRESS: 8, RESOLVED: 6, CLOSED: 7 });
    expect(await counts("priority")).toEqual({ LOW: 8, MEDIUM: 15, HIGH: 8, URGENT: 4 });
  });

  it("routes each request to its category's department", async () => {
    const rows = await db.serviceRequest.findMany({ include: { category: true } });
    for (const r of rows) expect(r.handlingDepartmentId).toBe(r.category.handlingDepartmentId);
  });

  it("assigns every non-SUBMITTED request to an active member of the handling department", async () => {
    const rows = await db.serviceRequest.findMany({ include: { assignee: { include: { status: true } } } });
    for (const r of rows) {
      if (r.status === "SUBMITTED") {
        expect(r.assigneeId).toBeNull();
      } else {
        expect(r.assignee?.departmentId).toBe(r.handlingDepartmentId);
        expect(r.assignee?.status.code).not.toBe("ON_NOTICE");
      }
    }
  });

  it("has a history that matches each request's status, step by step", async () => {
    const chain = ["SUBMITTED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];
    const rows = await db.serviceRequest.findMany({ include: { events: { orderBy: { createdAt: "asc" } } } });
    for (const r of rows) {
      expect(r.events.map((e) => e.toStatus)).toEqual(chain.slice(0, chain.indexOf(r.status) + 1));
      expect(r.events[0]).toMatchObject({ fromStatus: null, actorId: r.requesterId });
      r.events.slice(1).forEach((e, i) => expect(e.fromStatus).toBe(r.events[i].toStatus));
      expect(r.updatedAt.getTime()).toBe(r.events.at(-1)!.createdAt.getTime());
    }
  });

  it("only lets the right people act in the history", async () => {
    const rows = await db.serviceRequest.findMany({ include: { events: true, handlingDepartment: true, requester: true } });
    for (const r of rows) {
      for (const e of r.events) {
        if (e.toStatus === "ASSIGNED") expect([r.handlingDepartment.headId, base.personas.hrAdmin]).toContain(e.actorId);
        if (e.toStatus === "IN_PROGRESS" || e.toStatus === "RESOLVED") expect(e.actorId).toBe(r.assigneeId);
        if (e.toStatus === "CLOSED") expect([r.requesterId, base.personas.hrAdmin]).toContain(e.actorId);
      }
    }
  });

  it("never puts timestamps in the future", async () => {
    const now = Date.now();
    for (const e of await db.requestEvent.findMany()) expect(e.createdAt.getTime()).toBeLessThanOrEqual(now);
    for (const c of await db.requestComment.findMany()) expect(c.createdAt.getTime()).toBeLessThanOrEqual(now);
  });

  it("has at least 6 requests with 2–4 comments, written by people involved", async () => {
    const rows = await db.serviceRequest.findMany({ include: { comments: true, requester: true } });
    const threaded = rows.filter((r) => r.comments.length > 0);
    expect(threaded.length).toBeGreaterThanOrEqual(6);
    for (const r of threaded) {
      expect(r.comments.length).toBeGreaterThanOrEqual(2);
      expect(r.comments.length).toBeLessThanOrEqual(4);
      for (const c of r.comments) expect([r.requesterId, r.assigneeId, r.requester.managerId]).toContain(c.authorId);
    }
  });

  it("includes several requests from new hires, with open IT requests among them", async () => {
    const fromHires = await db.serviceRequest.findMany({ where: { requesterId: { in: base.newHireIds } }, include: { category: true } });
    expect(fromHires.length).toBeGreaterThanOrEqual(4);
    const openIt = fromHires.filter((r) => ["IT_EQUIPMENT", "SOFTWARE_ACCESS"].includes(r.category.code) && !["RESOLVED", "CLOSED"].includes(r.status));
    expect(openIt.length).toBeGreaterThanOrEqual(2);
    expect(new Set(openIt.map((r) => r.requesterId)).size).toBeGreaterThanOrEqual(2);
  });

  it("gives the IT support persona assigned requests spanning several statuses", async () => {
    const mine = await db.serviceRequest.findMany({ where: { assigneeId: base.personas.itSupport } });
    expect(mine.length).toBeGreaterThanOrEqual(3);
    expect(new Set(mine.map((r) => r.status)).size).toBeGreaterThanOrEqual(2);
  });

  it("is repeatable", async () => {
    const snapshot = async () =>
      (await db.serviceRequest.findMany({ orderBy: { reference: "asc" }, include: { requester: true } })).map((r) => `${r.reference}|${r.title}|${r.status}|${r.priority}|${r.requester.email}`);
    const before = await snapshot();
    await clearAll(db);
    const again = await seedBase(db, await bcrypt.hash("x", 4));
    await seedRequests(db, again);
    expect(await snapshot()).toEqual(before);
  });
});
