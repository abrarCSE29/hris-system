import { z } from "zod";
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

export async function getTeamDashboard(manager: AuthUser, days: Period = 30, today = todayInDhaka()) {
  const team = await prisma.user.findMany({
    where: { managerId: manager.id },
    select: { id: true, fullName: true, jobTitle: true },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
  });

  return {
    asOf: today,
    periodDays: days,
    periodStart: addDays(today, -(days - 1)),
    teamSize: team.length,
    requests: { open: 0, resolvedInPeriod: 0, avgHoursToResolve: null as number | null },
    tasks: { open: 0, overdue: 0, blocked: 0, completedOnTime: 0, completedLate: 0 },
    newHires: [] as { employee: { id: string; fullName: string }; instanceId: string; percentComplete: number; overdue: number; blocked: number }[],
    people: team.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      jobTitle: u.jobTitle,
      openRequests: 0,
      openTasks: 0,
      overdueTasks: 0,
      resolvedInPeriod: 0,
      tasksCompletedOnTime: 0,
      tasksCompletedLate: 0,
    })),
  };
}
