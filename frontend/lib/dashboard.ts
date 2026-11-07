import type { RequestPriority, RequestStatus } from "./types";

export interface DashboardSummary {
  asOf: string;
  headcountByCountry: { country: string; count: number }[];
  requestsByStatus: { status: RequestStatus; count: number }[];
  requestsByCategory: { category: { id: string; code: string; name: string }; count: number; open: number }[];
  onboarding: { activeHires: number; overdueTasks: number; blockedTasks: number };
  newHiresWithOpenItRequests: {
    count: number;
    hires: {
      id: string;
      fullName: string;
      country: string;
      instanceId: string;
      openRequests: { id: string; reference: string; title: string; status: RequestStatus; priority: RequestPriority }[];
    }[];
  };
  completionRateByCountry: { country: string; hires: number; tasksTotal: number; tasksCompleted: number; completionRate: number }[];
}

export const totalPeople = (s: DashboardSummary) => s.headcountByCountry.reduce((sum, c) => sum + c.count, 0);

/** Requests that still need work: not yet resolved or closed. */
export const openRequests = (s: DashboardSummary) =>
  s.requestsByStatus.filter((r) => r.status !== "RESOLVED" && r.status !== "CLOSED").reduce((sum, r) => sum + r.count, 0);

/** Data for the category chart: open and finished stacked, so the bar height is the total. */
export const categoryChartData = (s: DashboardSummary) =>
  s.requestsByCategory.map((c) => ({ name: c.category.name, open: c.open, finished: c.count - c.open }));
