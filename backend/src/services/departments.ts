import { loadLookups } from "@/lib/lookup-lists";
import { prisma } from "@/lib/prisma";

/**
 * Department breakdown for HR (spec §4.7). Computed from the live tables on every call. Everyone counts, whatever
 * their status, the same basis as the dashboard's headcount, so the totals agree. Every country, status and role is listed, with
 * zeros, so the table never misses a row. Each is returned as the object from its lookup table.
 */

export async function getDepartmentBreakdown() {
  const [departments, rows, lookups] = await Promise.all([
    prisma.department.findMany({
      select: { id: true, code: true, name: true, head: { select: { id: true, fullName: true } } },
    }),
    prisma.user.groupBy({ by: ["departmentId", "countryId", "statusId", "roleId"], _count: true }),
    loadLookups(),
  ]);

  const build = (departmentId: string) => {
    const mine = rows.filter((r) => r.departmentId === departmentId);
    const count = (match: (r: (typeof mine)[number]) => boolean) => mine.filter(match).reduce((n, r) => n + r._count, 0);
    return {
      headcount: count(() => true),
      byCountry: lookups.countries.map((country) => ({ country, count: count((r) => r.countryId === country.id) })),
      byStatus: lookups.statuses.map((status) => ({ status, count: count((r) => r.statusId === status.id) })),
      byRole: lookups.roles.map((role) => ({ role, count: count((r) => r.roleId === role.id) })),
    };
  };

  const list = departments
    .map((d) => ({ id: d.id, code: d.code, name: d.name, head: d.head, ...build(d.id) }))
    .sort((a, b) => b.headcount - a.headcount || a.name.localeCompare(b.name));

  return { total: list.reduce((n, d) => n + d.headcount, 0), departments: list };
}
