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
  it("creates 80 requests numbered SR-1001…SR-1080, oldest first", async () => {
    const rows = await db.serviceRequest.findMany({ orderBy: { reference: "asc" } });
    expect(rows).toHaveLength(80);
    expect(rows.map((r) => r.reference)).toEqual(Array.from({ length: 80 }, (_, i) => `SR-${1001 + i}`));
    const times = rows.map((r) => r.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("covers all 5 categories, 5 statuses and 4 priorities", async () => {
    expect(Object.keys(await counts("categoryId"))).toHaveLength(5);
    expect(await counts("status")).toEqual({ SUBMITTED: 10, ASSIGNED: 12, IN_PROGRESS: 14, RESOLVED: 16, CLOSED: 28 });
    expect(await counts("priority")).toEqual({ LOW: 18, MEDIUM: 34, HIGH: 19, URGENT: 9 });
  });

  it("routes a request to its category's department, or to the one that really owns it", async () => {
    const rows = await db.serviceRequest.findMany({ include: { category: true, handlingDepartment: true } });
    const rerouted = rows.filter((r) => r.handlingDepartmentId !== r.category.handlingDepartmentId);
    expect(rerouted.length).toBeGreaterThanOrEqual(20);
    // A repository, design-tool, finance-tool or contract request goes to Engineering, Marketing, Finance or Legal, not to IT or HR.
    expect(new Set(rerouted.map((r) => r.handlingDepartment.code))).toEqual(new Set(["ENG", "MKT", "FIN", "LEGAL", "OPS"]));
    expect(rows.find((r) => r.title === "Access to source code repository")?.handlingDepartment.code).toBe("ENG");
    expect(rows.find((r) => r.title === "Supplier contract review")?.handlingDepartment.code).toBe("LEGAL");
  });

  it("gives every department's team requests to work on, so every Manager has something on their dashboard", async () => {
    const departments = await db.department.findMany();
    for (const d of departments) {
      const handled = await db.serviceRequest.findMany({ where: { handlingDepartmentId: d.id } });
      expect(handled.length, `${d.code} handles`).toBeGreaterThanOrEqual(5);
      expect(handled.filter((r) => r.assigneeId !== null).length, `${d.code} assigned`).toBeGreaterThanOrEqual(3);
      expect(handled.filter((r) => ["RESOLVED", "CLOSED"].includes(r.status)).length, `${d.code} resolved`).toBeGreaterThanOrEqual(2);
      expect(handled.filter((r) => ["ASSIGNED", "IN_PROGRESS"].includes(r.status)).length, `${d.code} in hand`).toBeGreaterThanOrEqual(1);
    }
  });

  it("spreads requests over the last 90 days, with resolutions in every period the dashboard offers", async () => {
    const DAY = 86_400_000;
    const now = Date.now();
    const rows = await db.serviceRequest.findMany();
    expect(Math.max(...rows.map((r) => (now - r.createdAt.getTime()) / DAY))).toBeGreaterThanOrEqual(60);
    expect(Math.max(...rows.map((r) => (now - r.createdAt.getTime()) / DAY))).toBeLessThanOrEqual(95);
    expect(Math.min(...rows.map((r) => (now - r.createdAt.getTime()) / DAY))).toBeLessThanOrEqual(3);
    const resolved = (await db.requestEvent.findMany({ where: { toStatus: "RESOLVED" } })).map((e) => (now - e.createdAt.getTime()) / DAY);
    expect(resolved.filter((d) => d <= 7).length).toBeGreaterThanOrEqual(1);
    expect(resolved.filter((d) => d > 7 && d <= 30).length).toBeGreaterThanOrEqual(6);
    expect(resolved.filter((d) => d > 30 && d <= 90).length).toBeGreaterThanOrEqual(10);
  });

  it("takes realistic, varied time to resolve: some same-day, some several days, urgent ones faster than low ones", async () => {
    const HOUR = 3_600_000;
    const rows = await db.serviceRequest.findMany({ where: { status: { in: ["RESOLVED", "CLOSED"] } }, include: { events: true } });
    const hours = rows.map((r) => ({ priority: r.priority, h: (r.events.find((e) => e.toStatus === "RESOLVED")!.createdAt.getTime() - r.createdAt.getTime()) / HOUR }));
    expect(Math.min(...hours.map((x) => x.h))).toBeLessThan(24);
    expect(Math.max(...hours.map((x) => x.h))).toBeGreaterThan(72);
    expect(Math.max(...hours.map((x) => x.h))).toBeLessThan(24 * 14);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const of = (p: string) => hours.filter((x) => x.priority === p).map((x) => x.h);
    expect(mean(of("URGENT").concat(of("HIGH")))).toBeLessThan(mean(of("LOW").concat(of("MEDIUM"))));
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
    expect(threaded.length).toBeGreaterThanOrEqual(10);
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
