import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearAll, seedBase } from "../prisma/seed/base";
import { seedOnboarding } from "../prisma/seed/onboarding";
import { seedRequests } from "../prisma/seed/requests";
import type { AuthUser } from "@/lib/auth";
import { getTeamDashboard } from "@/services/team-dashboard";
import { db } from "./db";

/** The seeded company, seen through each Manager's team dashboard: every Manager must have something worth looking at. */
let base: Awaited<ReturnType<typeof seedBase>>;
let managers: { id: string; department: { code: string } }[];

beforeAll(async () => {
  await clearAll(db);
  base = await seedBase(db, await bcrypt.hash("x", 4));
  await seedRequests(db, base);
  await seedOnboarding(db, base);
  managers = await db.user.findMany({ where: { role: { code: "MANAGER" } }, select: { id: true, department: { select: { code: true } } } });
});
afterAll(() => db.$disconnect());

const dash = (id: string, days: 7 | 30 | 90 = 90) => getTeamDashboard({ id } as AuthUser, days);

describe("seeded team dashboards", () => {
  it("has seven Managers, each with a team", async () => {
    expect(managers).toHaveLength(7);
    for (const m of managers) expect((await dash(m.id)).teamSize, m.department.code).toBeGreaterThanOrEqual(5);
  });

  it("gives every Manager request work over 90 days, and a new hire or onboarding task to follow", async () => {
    for (const m of managers) {
      const d = await dash(m.id);
      expect(d.requests.open + d.requests.resolvedInPeriod, `${m.department.code} requests`).toBeGreaterThanOrEqual(3);
      expect((await dash(m.id, 30)).requests.resolvedInPeriod, `${m.department.code} resolved in 30 days`).toBeGreaterThanOrEqual(1);
      expect(d.tasks.open + d.tasks.completedOnTime + d.tasks.completedLate + d.newHires.length, `${m.department.code} onboarding`).toBeGreaterThanOrEqual(1);
    }
  });

  it("shows the demo Engineering Manager a busy dashboard: requests, tasks and their new hire", async () => {
    const d = await dash(base.personas.manager);
    expect(d.requests.open).toBeGreaterThanOrEqual(1);
    expect(d.requests.resolvedInPeriod).toBeGreaterThanOrEqual(2); // over the last 90 days
    expect((await dash(base.personas.manager, 30)).requests.resolvedInPeriod).toBeGreaterThanOrEqual(1); // and the default 30
    expect((await dash(base.personas.manager, 30)).requests.avgHoursToResolve).toBeGreaterThan(0);
    expect(d.tasks.open + d.tasks.completedOnTime + d.tasks.completedLate).toBeGreaterThanOrEqual(1);
    expect(d.newHires.length).toBeGreaterThanOrEqual(1);
    expect(d.people.filter((p) => p.openRequests + p.openTasks + p.resolvedInPeriod > 0).length).toBeGreaterThanOrEqual(3);
  });

  it("shows the IT Operations Manager the most: requests, tasks done on time and late, and a new hire", async () => {
    const d = await dash(base.personas.itManager);
    expect(d.requests.open).toBeGreaterThanOrEqual(3);
    expect(d.requests.resolvedInPeriod).toBeGreaterThanOrEqual(3);
    expect(d.tasks.completedOnTime + d.tasks.completedLate).toBeGreaterThanOrEqual(1);
    expect(d.newHires.length).toBeGreaterThanOrEqual(1);
  });

  it("changes with the period: a shorter period resolves fewer requests", async () => {
    let shorter = 0;
    for (const m of managers) {
      const [w, mo, q] = [await dash(m.id, 7), await dash(m.id, 30), await dash(m.id, 90)];
      expect(w.requests.resolvedInPeriod).toBeLessThanOrEqual(mo.requests.resolvedInPeriod);
      expect(mo.requests.resolvedInPeriod).toBeLessThanOrEqual(q.requests.resolvedInPeriod);
      if (w.requests.resolvedInPeriod < q.requests.resolvedInPeriod) shorter++;
    }
    expect(shorter).toBeGreaterThanOrEqual(5);
  });

  it("has overdue and blocked onboarding work somewhere, and late completions somewhere", async () => {
    const all = await Promise.all(managers.map((m) => dash(m.id)));
    expect(all.reduce((n, d) => n + d.tasks.overdue, 0)).toBeGreaterThanOrEqual(2);
    expect(all.reduce((n, d) => n + d.tasks.blocked, 0)).toBeGreaterThanOrEqual(1);
    expect(all.reduce((n, d) => n + d.tasks.completedLate, 0)).toBeGreaterThanOrEqual(2);
  });
});
