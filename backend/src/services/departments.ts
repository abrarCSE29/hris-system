import { Country, Role, UserStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Department breakdown for HR (spec §4.7). Computed from the live tables on every call. Everyone counts, whatever
 * their status, the same basis as the dashboard's headcount, so the totals agree.
 */

const COUNTRIES = Object.values(Country);
const STATUSES = Object.values(UserStatus);
const ROLES = Object.values(Role);

export async function getDepartmentBreakdown() {
  const [departments, rows] = await Promise.all([
    prisma.department.findMany({
      select: { id: true, code: true, name: true, head: { select: { id: true, fullName: true } } },
    }),
    prisma.user.groupBy({ by: ["departmentId", "country", "status", "role"], _count: true }),
  ]);

  const build = (departmentId: string) => {
    const mine = rows.filter((r) => r.departmentId === departmentId);
    const split = <K extends "country" | "status" | "role">(key: K, values: readonly string[]) =>
      values.map((v) => ({ [key]: v, count: mine.filter((r) => r[key] === v).reduce((n, r) => n + r._count, 0) }));
    return {
      headcount: mine.reduce((n, r) => n + r._count, 0),
      byCountry: split("country", COUNTRIES) as { country: Country; count: number }[],
      byStatus: split("status", STATUSES) as { status: UserStatus; count: number }[],
      byRole: split("role", ROLES) as { role: Role; count: number }[],
    };
  };

  const list = departments
    .map((d) => ({ id: d.id, code: d.code, name: d.name, head: d.head, ...build(d.id) }))
    .sort((a, b) => b.headcount - a.headcount || a.name.localeCompare(b.name));

  return { total: list.reduce((n, d) => n + d.headcount, 0), departments: list };
}
