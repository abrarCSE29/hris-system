import type { CountryRef } from "./types";

/** Response of GET /dashboard/team (spec docs/spec-manager-dashboard.md). */
export interface TeamDashboard {
  asOf: string;
  periodDays: 7 | 30 | 90;
  /** First day of the period, in Dhaka time. */
  periodStart: string;
  teamSize: number;
  requests: { open: number; resolvedInPeriod: number; avgHoursToResolve: number | null };
  tasks: { open: number; overdue: number; blocked: number; completedOnTime: number; completedLate: number };
  newHires: { employee: { id: string; fullName: string; country: CountryRef }; instanceId: string; percentComplete: number; overdue: number; blocked: number }[];
  people: {
    id: string;
    fullName: string;
    jobTitle: string;
    openRequests: number;
    openTasks: number;
    overdueTasks: number;
    resolvedInPeriod: number;
    tasksCompletedOnTime: number;
    tasksCompletedLate: number;
  }[];
}

export const PERIOD_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

/** Hours as "6 h", "1 d 21 h" or "5 d"; a dash when there is no figure. Rounded to the hour. */
export function formatDuration(hours: number | null): string {
  if (hours === null) return "—";
  const total = Math.round(hours);
  const days = Math.floor(total / 24);
  const rest = total % 24;
  if (days === 0) return `${rest} h`;
  return rest === 0 ? `${days} d` : `${days} d ${rest} h`;
}
