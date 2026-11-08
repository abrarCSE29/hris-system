import { Country, RequestStatus, type Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { todayInDhaka } from "./onboarding-logic";

/**
 * HR dashboard (spec §4.6). Everything here is computed from the live tables, never stored, so it
 * cannot drift. The last two fields are the cross-module insights: they join requests with onboarding.
 */

/** The department the "waiting on" card shows first. */
export const IT_DEPARTMENT_CODE = "ITOPS";

/** A request is open until it is resolved. */
export const OPEN_REQUEST_STATUSES: RequestStatus[] = ["SUBMITTED", "ASSIGNED", "IN_PROGRESS"];

const COUNTRIES = Object.values(Country);
const STATUSES = Object.values(RequestStatus); // workflow order

export async function getDashboardSummary(today = todayInDhaka()) {
  const todayDate = new Date(`${today}T00:00:00Z`);
  const inActiveChecklist: Prisma.OnboardingTaskWhereInput = { instance: { status: "ACTIVE" }, status: { not: "COMPLETED" } };

  const [headcount, byStatus, categories, openByCategory, categoryTotals, activeHires, overdueTasks, blockedTasks, hiresWithOpenRequests, handlingDepartments, completion] =
    await Promise.all([
      prisma.user.groupBy({ by: ["country"], _count: true }),
      prisma.serviceRequest.groupBy({ by: ["status"], _count: true }),
      prisma.requestCategory.findMany({ select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
      prisma.serviceRequest.groupBy({ by: ["categoryId"], where: { status: { in: OPEN_REQUEST_STATUSES } }, _count: true }),
      prisma.serviceRequest.groupBy({ by: ["categoryId"], _count: true }),
      prisma.onboardingInstance.count({ where: { status: "ACTIVE" } }),
      prisma.onboardingTask.count({ where: { ...inActiveChecklist, dueDate: { lt: todayDate } } }),
      prisma.onboardingTask.count({ where: { ...inActiveChecklist, dependsOnId: { not: null }, dependsOn: { is: { status: { not: "COMPLETED" } } } } }),
      // New hires (an ACTIVE checklist) with at least one open request, whichever department it is routed to.
      prisma.user.findMany({
        where: {
          onboardingInstances: { some: { status: "ACTIVE" } },
          submittedRequests: { some: { status: { in: OPEN_REQUEST_STATUSES } } },
        },
        select: {
          id: true,
          fullName: true,
          country: true,
          department: { select: { id: true, name: true } },
          onboardingInstances: { where: { status: "ACTIVE" }, select: { id: true } },
          submittedRequests: {
            where: { status: { in: OPEN_REQUEST_STATUSES } },
            select: { id: true, reference: true, title: true, status: true, priority: true, handlingDepartmentId: true },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { fullName: "asc" },
      }),
      // Departments that requests can be routed to (they handle at least one category).
      prisma.department.findMany({
        where: { requestCategories: { some: {} } },
        select: { id: true, code: true, name: true },
        orderBy: { name: "asc" },
      }),
      // Task completion per hire's country, over every checklist (active and finished).
      prisma.$queryRaw<{ country: Country; hires: bigint; tasks_total: bigint; tasks_done: bigint }[]>`
        SELECT u.country::text AS country,
               COUNT(DISTINCT i.id) AS hires,
               COUNT(t.id) AS tasks_total,
               COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED') AS tasks_done
        FROM onboarding_instances i
        JOIN users u ON u.id = i.employee_id
        LEFT JOIN onboarding_tasks t ON t.instance_id = i.id
        GROUP BY u.country`,
    ]);

  const headcountOf = (c: Country) => headcount.find((r) => r.country === c)?._count ?? 0;
  const statusCount = (st: RequestStatus) => byStatus.find((r) => r.status === st)?._count ?? 0;
  const byCat = (rows: { categoryId: string; _count: number }[], id: string) => rows.find((r) => r.categoryId === id)?._count ?? 0;
  const completionOf = (c: Country) => {
    const r = completion.find((x) => x.country === c);
    const total = Number(r?.tasks_total ?? 0);
    const done = Number(r?.tasks_done ?? 0);
    return {
      country: c,
      hires: Number(r?.hires ?? 0),
      tasksTotal: total,
      tasksCompleted: done,
      // Share of all assigned onboarding tasks that are done. 0 when nobody has been onboarded there.
      completionRate: total === 0 ? 0 : Math.round((done / total) * 100),
    };
  };

  return {
    asOf: today,
    // Every country / status / category is listed, with zeros, so charts never have missing bars.
    headcountByCountry: COUNTRIES.map((c) => ({ country: c, count: headcountOf(c) })),
    requestsByStatus: STATUSES.map((s) => ({ status: s, count: statusCount(s) })),
    requestsByCategory: categories.map((c) => ({ category: c, count: byCat(categoryTotals, c.id), open: byCat(openByCategory, c.id) })),
    onboarding: { activeHires, overdueTasks, blockedTasks },
    // Cross-module: new hires who are still waiting on a department, one entry per department that handles requests
    // (IT Operations first, then the rest by name). A hire appears under every department they are waiting on.
    newHiresWaiting: handlingDepartments
      .map((d) => {
        const hires = hiresWithOpenRequests
          .map((h) => ({ h, open: h.submittedRequests.filter((r) => r.handlingDepartmentId === d.id) }))
          .filter(({ open }) => open.length > 0)
          .map(({ h, open }) => ({
            id: h.id,
            fullName: h.fullName,
            country: h.country,
            department: h.department,
            instanceId: h.onboardingInstances[0].id,
            openRequests: open.map(({ handlingDepartmentId: _omit, ...r }) => r),
          }));
        return { department: d, count: hires.length, hires };
      })
      .sort((a, b) => Number(b.department.code === IT_DEPARTMENT_CODE) - Number(a.department.code === IT_DEPARTMENT_CODE) || a.department.name.localeCompare(b.department.name)),
    // Cross-module: how far along onboarding is, by where the hire works.
    completionRateByCountry: COUNTRIES.map(completionOf),
  };
}
