import { z } from "zod";
import type { RequestStatus } from "@/generated/prisma/client";
import type { AuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { addDays, isBlocked, isOverdue, summarize, todayInDhaka, toIsoDate } from "./onboarding-logic";

/**
 * Manager dashboard (spec docs/spec-manager-dashboard.md). Computed live from the tables, never stored.
 * The team is the manager's direct reports; every number below is filtered to them.
 */

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export const teamQuery = z.object({
  /** The last N days, today included. */
  days: z.enum(PERIODS.map(String) as [string, ...string[]]).default("30").transform((d) => Number(d) as Period),
});

/** Asia/Dhaka has no daylight saving: midnight there is always 18:00 UTC the evening before. */
const dhakaMidnight = (isoDate: string) => new Date(`${isoDate}T00:00:00+06:00`);

/** The calendar date in Asia/Dhaka of a moment, as YYYY-MM-DD. */
const dhakaDate = (moment: Date) => new Date(moment.getTime() + 6 * 3_600_000).toISOString().slice(0, 10);

/** Requests that are being worked on: assigned or in progress. A submitted request has no owner yet; a resolved one is done. */
const OPEN_STATUSES: RequestStatus[] = ["ASSIGNED", "IN_PROGRESS"];

export async function getTeamDashboard(manager: AuthUser, days: Period = 30, today = todayInDhaka()) {
  const team = await prisma.user.findMany({
    where: { managerId: manager.id },
    select: { id: true, fullName: true, jobTitle: true },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
  });

  const ids = team.map((u) => u.id);
  const from = dhakaMidnight(addDays(today, -(days - 1)));
  const until = dhakaMidnight(addDays(today, 1)); // end of today, exclusive

  // Every query below is limited to the team's own ids; with no team there is nothing to ask.
  const [openRows, resolvedEvents, openTasks, completedTasks, activeChecklists] = ids.length === 0 ? [[], [], [], [], []] : await Promise.all([
    prisma.serviceRequest.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: { in: OPEN_STATUSES } }, _count: true }),
    // A request is resolved once (Resolved only moves on to Closed), so one RESOLVED event per request.
    prisma.requestEvent.findMany({
      where: { toStatus: "RESOLVED", createdAt: { gte: from, lt: until }, request: { assigneeId: { in: ids } } },
      select: { createdAt: true, request: { select: { assigneeId: true, createdAt: true } } },
    }),
    // Onboarding tasks are the team's by their own assignee. Overdue and blocked use the same rules as the task queue.
    prisma.onboardingTask.findMany({
      where: { assigneeId: { in: ids }, status: { not: "COMPLETED" } },
      select: { assigneeId: true, status: true, dueDate: true, dependsOn: { select: { status: true } } },
    }),
    prisma.onboardingTask.findMany({
      where: { assigneeId: { in: ids }, status: "COMPLETED", completedAt: { gte: from, lt: until } },
      select: { assigneeId: true, dueDate: true, completedAt: true },
    }),
    // The team's own new hires: direct reports with an ACTIVE checklist, whoever the tasks are assigned to.
    prisma.onboardingInstance.findMany({
      where: { status: "ACTIVE", employeeId: { in: ids } },
      select: {
        id: true,
        employee: { select: { id: true, fullName: true, country: { select: { id: true, shortcode: true, name: true } } } },
        tasks: { select: { status: true, dueDate: true, dependsOn: { select: { status: true } } } },
      },
    }),
  ]);

  const openBy = new Map(openRows.map((r) => [r.assigneeId, r._count]));
  const resolvedBy = new Map<string, number>();
  let resolvedMs = 0;
  for (const e of resolvedEvents) {
    resolvedBy.set(e.request.assigneeId!, (resolvedBy.get(e.request.assigneeId!) ?? 0) + 1);
    resolvedMs += e.createdAt.getTime() - e.request.createdAt.getTime();
  }
  const open = new Map<string, number>(), overdue = new Map<string, number>(), onTime = new Map<string, number>(), late = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  let blocked = 0;
  for (const t of openTasks) {
    const facts = { status: t.status, dependsOnStatus: t.dependsOn?.status ?? null, dueDate: toIsoDate(t.dueDate) };
    bump(open, t.assigneeId!);
    if (isOverdue(facts, today)) bump(overdue, t.assigneeId!);
    if (isBlocked(facts)) blocked++;
  }
  for (const t of completedTasks) {
    // On time = finished on or before the due day (a calendar day in Dhaka); late = after it.
    bump(dhakaDate(t.completedAt!) <= toIsoDate(t.dueDate) ? onTime : late, t.assigneeId!);
  }
  const oneDecimal = (n: number) => Math.round(n * 10) / 10;
  const people = team.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    jobTitle: u.jobTitle,
    openRequests: openBy.get(u.id) ?? 0,
    openTasks: open.get(u.id) ?? 0,
    overdueTasks: overdue.get(u.id) ?? 0,
    resolvedInPeriod: resolvedBy.get(u.id) ?? 0,
    tasksCompletedOnTime: onTime.get(u.id) ?? 0,
    tasksCompletedLate: late.get(u.id) ?? 0,
  }));

  return {
    asOf: today,
    periodDays: days,
    periodStart: addDays(today, -(days - 1)),
    teamSize: team.length,
    requests: {
      open: people.reduce((n, p) => n + p.openRequests, 0),
      resolvedInPeriod: resolvedEvents.length,
      avgHoursToResolve: resolvedEvents.length === 0 ? null : oneDecimal(resolvedMs / resolvedEvents.length / 3_600_000),
    },
    tasks: {
      open: openTasks.length,
      overdue: people.reduce((n, p) => n + p.overdueTasks, 0),
      blocked,
      completedOnTime: people.reduce((n, p) => n + p.tasksCompletedOnTime, 0),
      completedLate: people.reduce((n, p) => n + p.tasksCompletedLate, 0),
    },
    newHires: activeChecklists
      .map((i) => {
        const progress = summarize(i.tasks.map((t) => ({ status: t.status, dependsOnStatus: t.dependsOn?.status ?? null, dueDate: toIsoDate(t.dueDate) })), today);
        return { employee: i.employee, instanceId: i.id, percentComplete: progress.percentComplete, overdue: progress.overdue, blocked: progress.blocked };
      })
      // Same order as the people list (the database's name order), so the two never disagree.
      .sort((a, b) => ids.indexOf(a.employee.id) - ids.indexOf(b.employee.id)),
    people,
  };
}
