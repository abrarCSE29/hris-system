import type { Role, UserStatus } from "./types";

export interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  head: { id: string; fullName: string } | null;
  headcount: number;
  byCountry: { country: string; count: number }[];
  byStatus: { status: UserStatus; count: number }[];
  byRole: { role: Role; count: number }[];
}

export interface DepartmentBreakdown {
  total: number;
  departments: DepartmentRow[];
}

/** Whole-number share of the company, "0%" when the company is empty. */
export const sharePercent = (count: number, total: number) => (total === 0 ? 0 : Math.round((count / total) * 100));

/** "2 on probation · 1 on notice": only the non-zero, non-default statuses; "—" when there are none. */
export function statusSentence(byStatus: DepartmentRow["byStatus"]): string {
  const parts = byStatus
    .filter((s) => s.status !== "ACTIVE" && s.count > 0)
    .map((s) => `${s.count} ${s.status === "ON_PROBATION" ? "on probation" : "on notice"}`);
  return parts.length ? parts.join(" · ") : "—";
}

/** "3 managers · 1 HR admin": employees are the norm so they are left out; "—" when there are none of the others. */
export function roleSentence(byRole: DepartmentRow["byRole"]): string {
  const label = { MANAGER: ["manager", "managers"], HR_ADMIN: ["HR admin", "HR admins"] } as const;
  const parts = byRole
    .filter((r) => r.role !== "EMPLOYEE" && r.count > 0)
    .map((r) => `${r.count} ${label[r.role as "MANAGER" | "HR_ADMIN"][r.count === 1 ? 0 : 1]}`);
  return parts.length ? parts.join(" · ") : "—";
}
