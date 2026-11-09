import type { Prisma } from "@/generated/prisma/client";
import type { AuthUser } from "@/lib/auth";

/**
 * Row scoping: functions return Prisma `where` clauses that every query for that resource must use.
 * Rows outside the scope are invisible (detail endpoints answer 404).
 */

/** HR Admin: everyone. Manager: direct reports. Anyone else: only themselves (defence in depth). */
export function scopeUsers(user: AuthUser): Prisma.UserWhereInput {
  if (user.role.code === "HR_ADMIN") return {};
  if (user.role.code === "MANAGER") return { managerId: user.id };
  return { id: user.id };
}

/**
 * Service requests a user may see (spec §5.3):
 * - everyone: requests they submitted or are assigned to
 * - Manager: + requests from their direct reports, + the queue of the department they head
 * - HR Admin: everything
 */
export function scopeRequests(user: AuthUser): Prisma.ServiceRequestWhereInput {
  if (user.role.code === "HR_ADMIN") return {};
  const scope: Prisma.ServiceRequestWhereInput[] = [{ requesterId: user.id }, { assigneeId: user.id }];
  if (user.role.code === "MANAGER") {
    scope.push({ requester: { managerId: user.id } });
    if (user.headOfDepartmentId) scope.push({ handlingDepartmentId: user.headOfDepartmentId });
  }
  return { OR: scope };
}

/**
 * Onboarding checklists a user may see (spec §5.2):
 * HR Admin: all. Manager: their direct reports'. Anyone: their own.
 */
export function scopeInstances(user: AuthUser): Prisma.OnboardingInstanceWhereInput {
  if (user.role.code === "HR_ADMIN") return {};
  const scope: Prisma.OnboardingInstanceWhereInput[] = [{ employeeId: user.id }];
  if (user.role.code === "MANAGER") scope.push({ employee: { managerId: user.id } });
  return { OR: scope };
}

/**
 * Onboarding tasks a user OWNS (the task queue): the tasks assigned to them (a department task the head delegated, or a
 * MANAGER-type task), and, for the head of a department, every task that department owns, assigned or not. Other members
 * of a department do not see its unassigned tasks. HR Admin sees the whole queue (read only; see `isTaskOwner`).
 */
export function scopeOwnedTasks(user: AuthUser): Prisma.OnboardingTaskWhereInput {
  if (user.role.code === "HR_ADMIN") return {};
  const scope: Prisma.OnboardingTaskWhereInput[] = [{ assigneeId: user.id }];
  if (user.headOfDepartmentId) scope.push({ ownerType: "DEPARTMENT", ownerDepartmentId: user.headOfDepartmentId });
  return { OR: scope };
}

/** Tasks a user may open: the ones they own, plus every task on a checklist they can see. */
export function scopeVisibleTasks(user: AuthUser): Prisma.OnboardingTaskWhereInput {
  if (user.role.code === "HR_ADMIN") return {};
  return { OR: [scopeOwnedTasks(user), { instance: scopeInstances(user) }] };
}
