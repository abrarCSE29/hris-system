import { z } from "zod";
import type { RequestStatus } from "@/generated/prisma/client";
import type { AuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { addDays, todayInDhaka } from "./onboarding-logic";

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
  const [openRows, resolvedEvents] = ids.length === 0 ? [[], []] : await Promise.all([
    prisma.serviceRequest.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: { in: OPEN_STATUSES } }, _count: true }),
    // A request is resolved once (Resolved only moves on to Closed), so one RESOLVED event per request.
    prisma.requestEvent.findMany({
      where: { toStatus: "RESOLVED", createdAt: { gte: from, lt: until }, request: { assigneeId: { in: ids } } },
      select: { createdAt: true, request: { select: { assigneeId: true, createdAt: true } } },
    }),
  ]);

  const openBy = new Map(openRows.map((r) => [r.assigneeId, r._count]));
  const resolvedBy = new Map<string, number>();
  let resolvedMs = 0;
  for (const e of resolvedEvents) {
    resolvedBy.set(e.request.assigneeId!, (resolvedBy.get(e.request.assigneeId!) ?? 0) + 1);
    resolvedMs += e.createdAt.getTime() - e.request.createdAt.getTime();
  }
  const oneDecimal = (n: number) => Math.round(n * 10) / 10;
  const people = team.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    jobTitle: u.jobTitle,
    openRequests: openBy.get(u.id) ?? 0,
    openTasks: 0,
    overdueTasks: 0,
    resolvedInPeriod: resolvedBy.get(u.id) ?? 0,
    tasksCompletedOnTime: 0,
    tasksCompletedLate: 0,
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
    tasks: { open: 0, overdue: 0, blocked: 0, completedOnTime: 0, completedLate: 0 },
    newHires: [] as { employee: { id: string; fullName: string }; instanceId: string; percentComplete: number; overdue: number; blocked: number }[],
    people,
  };
}
