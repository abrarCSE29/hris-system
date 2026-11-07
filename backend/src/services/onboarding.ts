import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Country, OnboardingInstanceStatus, Prisma } from "@/generated/prisma/client";
import type { AuthUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { paginated, type Paging } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { isoDate } from "@/lib/validation";
import {
  addDays, displayStatus, isBlocked, isOverdue, summarize, todayInDhaka, toIsoDate, type TaskFacts,
} from "./onboarding-logic";
import { scopeInstances, scopeOwnedTasks, scopeVisibleTasks } from "./policy";
import { allowedTaskActions, checkTaskTransition, type TaskAction, type TaskActor } from "./state-machine";

type Db = Prisma.TransactionClient;

// ── input ────────────────────────────────────────────────────────────────────

export const createInstanceBody = z
  .object({ employeeId: z.uuid(), templateId: z.uuid(), startDate: isoDate.optional() })
  .strict();

export const listInstancesQuery = z.object({
  country: z.enum(Country).optional(),
  status: z.enum(OnboardingInstanceStatus).optional(),
});

export const listTasksQuery = z.object({
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "BLOCKED"]).optional(),
  overdue: z.enum(["true", "false"]).optional(),
});

export const taskTransitionBody = z.object({ action: z.enum(["start", "complete"]) }).strict();

// ── task view ────────────────────────────────────────────────────────────────

const taskInclude = {
  ownerDepartment: { select: { id: true, code: true, name: true } },
  assignee: { select: { id: true, fullName: true } },
  completedBy: { select: { id: true, fullName: true } },
  dependsOn: { select: { id: true, title: true, status: true } },
} satisfies Prisma.OnboardingTaskInclude;

type TaskRow = Prisma.OnboardingTaskGetPayload<{ include: typeof taskInclude }>;

const factsOf = (t: TaskRow): TaskFacts => ({
  status: t.status,
  dependsOnStatus: t.dependsOn?.status ?? null,
  dueDate: toIsoDate(t.dueDate),
});

export const toTaskActor = (u: AuthUser): TaskActor => ({ id: u.id, role: u.role, departmentId: u.department.id });

/** A task as the API returns it: stored status plus the calculated Blocked / Overdue, and what the viewer may do. */
export function serializeTask(t: TaskRow, today: string, viewer: AuthUser) {
  const facts = factsOf(t);
  const blocked = isBlocked(facts);
  return {
    id: t.id,
    instanceId: t.instanceId,
    title: t.title,
    description: t.description,
    ownerType: t.ownerType,
    ownerDepartment: t.ownerDepartment,
    assignee: t.assignee,
    dueDate: facts.dueDate,
    status: t.status,
    displayStatus: displayStatus(facts),
    blocked,
    overdue: isOverdue(facts, today),
    dependsOn: t.dependsOn ? { id: t.dependsOn.id, title: t.dependsOn.title } : null,
    completedAt: t.completedAt?.toISOString() ?? null,
    completedBy: t.completedBy,
    sortOrder: t.sortOrder,
    allowedActions: allowedTaskActions(
      { status: t.status, blocked, waitingFor: t.dependsOn?.title, ownerType: t.ownerType, ownerDepartmentId: t.ownerDepartmentId, assigneeId: t.assigneeId },
      toTaskActor(viewer),
    ),
  };
}

const notFound = (what = "Onboarding checklist") => new ApiError("NOT_FOUND", `${what} not found`);
const asUuid = (id: string, what?: string) => {
  if (!z.uuid().safeParse(id).success) throw notFound(what);
};

// ── creating a checklist ─────────────────────────────────────────────────────

/**
 * Copies a template's tasks onto an employee: due = start date + offset, MANAGER tasks go to the
 * employee's manager, dependencies are remapped to the copies. Runs inside the caller's transaction
 * so that (for example) creating a user and their checklist succeed or fail together.
 */
export async function createChecklist(db: Db, input: { employeeId: string; templateId: string; startDate?: string }) {
  const employee = await db.user.findUnique({
    where: { id: input.employeeId },
    select: { id: true, managerId: true, joiningDate: true },
  });
  if (!employee) throw new ApiError("VALIDATION_FAILED", "Unknown employee", [{ path: "employeeId", message: "Employee not found" }]);

  const template = await db.onboardingTemplate.findUnique({
    where: { id: input.templateId },
    include: { tasks: { orderBy: { sortOrder: "asc" } } },
  });
  if (!template) throw new ApiError("VALIDATION_FAILED", "Unknown template", [{ path: "templateId", message: "Template not found" }]);

  if (template.tasks.some((t) => t.ownerType === "MANAGER") && !employee.managerId) {
    throw new ApiError("VALIDATION_FAILED", "This template has manager tasks but the employee has no manager", [
      { path: "employeeId", message: "Employee has no manager" },
    ]);
  }
  const active = await db.onboardingInstance.findFirst({ where: { employeeId: employee.id, status: "ACTIVE" }, select: { id: true } });
  if (active) throw new ApiError("CONFLICT", "This employee already has an active onboarding checklist");

  const startDate = input.startDate ?? toIsoDate(employee.joiningDate);
  const idMap = new Map(template.tasks.map((t) => [t.id, randomUUID()]));

  const instance = await db.onboardingInstance.create({
    data: { employeeId: employee.id, templateId: template.id, startDate: new Date(`${startDate}T00:00:00Z`) },
  });
  // One insert: the copies reference each other through depends_on_id.
  await db.onboardingTask.createMany({
    data: template.tasks.map((t) => ({
      id: idMap.get(t.id)!,
      instanceId: instance.id,
      title: t.title,
      description: t.description,
      ownerType: t.ownerType,
      ownerDepartmentId: t.ownerDepartmentId,
      assigneeId: t.ownerType === "MANAGER" ? employee.managerId : null,
      dueDate: new Date(`${addDays(startDate, t.offsetDays)}T00:00:00Z`),
      dependsOnId: t.dependsOnId ? idMap.get(t.dependsOnId)! : null,
      sortOrder: t.sortOrder,
    })),
  });
  return { instanceId: instance.id, taskCount: template.tasks.length };
}

export async function assignChecklist(actor: AuthUser, input: z.infer<typeof createInstanceBody>) {
  let created: { instanceId: string; taskCount: number };
  try {
    created = await prisma.$transaction((tx) => createChecklist(tx, input));
  } catch (e) {
    // Two assignments racing past the check: the partial unique index rejects the second.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ApiError("CONFLICT", "This employee already has an active onboarding checklist");
    }
    throw e;
  }
  return getInstanceDetail(actor, created.instanceId);
}

// ── reading checklists ───────────────────────────────────────────────────────

const instanceInclude = {
  employee: { select: { id: true, fullName: true, email: true, country: true, jobTitle: true, managerId: true, department: { select: { id: true, code: true, name: true } } } },
  template: { select: { id: true, name: true } },
  tasks: { include: taskInclude, orderBy: { sortOrder: "asc" } },
} satisfies Prisma.OnboardingInstanceInclude;

type InstanceRow = Prisma.OnboardingInstanceGetPayload<{ include: typeof instanceInclude }>;

function serializeInstanceHeader(i: InstanceRow, today: string) {
  return {
    id: i.id,
    status: i.status,
    startDate: toIsoDate(i.startDate),
    createdAt: i.createdAt.toISOString(),
    employee: i.employee,
    template: i.template,
    progress: summarize(i.tasks.map(factsOf), today),
  };
}

export async function getInstanceDetail(actor: AuthUser, id: string, today = todayInDhaka()) {
  asUuid(id);
  const row = await prisma.onboardingInstance.findFirst({ where: { AND: [{ id }, scopeInstances(actor)] }, include: instanceInclude });
  if (!row) throw notFound();
  return { ...serializeInstanceHeader(row, today), tasks: row.tasks.map((t) => serializeTask(t, today, actor)) };
}

/** The user's own checklist: the active one, otherwise the most recent finished one, otherwise null. */
export async function getMyChecklist(actor: AuthUser, today = todayInDhaka()) {
  const row =
    (await prisma.onboardingInstance.findFirst({ where: { employeeId: actor.id, status: "ACTIVE" }, select: { id: true } })) ??
    (await prisma.onboardingInstance.findFirst({ where: { employeeId: actor.id }, orderBy: { createdAt: "desc" }, select: { id: true } }));
  return row ? getInstanceDetail(actor, row.id, today) : null;
}

export async function listInstances(actor: AuthUser, q: z.infer<typeof listInstancesQuery>, paging: Paging, today = todayInDhaka()) {
  const where: Prisma.OnboardingInstanceWhereInput = {
    AND: [scopeInstances(actor), { status: q.status, ...(q.country && { employee: { country: q.country } }) }],
  };
  const [rows, total] = await Promise.all([
    prisma.onboardingInstance.findMany({
      where,
      include: instanceInclude,
      orderBy: [{ startDate: "desc" }, { id: "asc" }],
      skip: paging.skip,
      take: paging.take,
    }),
    prisma.onboardingInstance.count({ where }),
  ]);
  return paginated(rows.map((r) => serializeInstanceHeader(r, today)), total, paging);
}

// ── task queue ───────────────────────────────────────────────────────────────

export async function listTasks(actor: AuthUser, q: z.infer<typeof listTasksQuery>, paging: Paging, today = todayInDhaka()) {
  const unfinished: Prisma.OnboardingTaskWhereInput = { status: { not: "COMPLETED" } };
  const notBlocked: Prisma.OnboardingTaskWhereInput = { OR: [{ dependsOnId: null }, { dependsOn: { is: { status: "COMPLETED" } } }] };
  const blocked: Prisma.OnboardingTaskWhereInput = { ...unfinished, dependsOnId: { not: null }, dependsOn: { is: { status: { not: "COMPLETED" } } } };

  // The queue shows unfinished work unless a status is asked for.
  const byStatus: Prisma.OnboardingTaskWhereInput =
    q.status === "COMPLETED" ? { status: "COMPLETED" }
    : q.status === "BLOCKED" ? blocked
    : q.status === "IN_PROGRESS" || q.status === "NOT_STARTED" ? { AND: [{ status: q.status }, notBlocked] }
    : unfinished;
  const byOverdue: Prisma.OnboardingTaskWhereInput | undefined =
    q.overdue === "true" ? { ...unfinished, dueDate: { lt: new Date(`${today}T00:00:00Z`) } }
    : q.overdue === "false" ? { OR: [{ status: "COMPLETED" }, { dueDate: { gte: new Date(`${today}T00:00:00Z`) } }] }
    : undefined;

  const where: Prisma.OnboardingTaskWhereInput = { AND: [scopeOwnedTasks(actor), byStatus, ...(byOverdue ? [byOverdue] : [])] };
  const include = { ...taskInclude, instance: { select: { employee: { select: { id: true, fullName: true, country: true } } } } };
  const [rows, total] = await Promise.all([
    prisma.onboardingTask.findMany({ where, include, orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }, { id: "asc" }], skip: paging.skip, take: paging.take }),
    prisma.onboardingTask.count({ where }),
  ]);
  return paginated(rows.map((t) => ({ ...serializeTask(t, today, actor), employee: t.instance.employee })), total, paging);
}

// ── task transitions ─────────────────────────────────────────────────────────

/**
 * Starts or completes a task. The blocked check is repeated inside the transaction, and the
 * instance row is locked so that two people finishing the last tasks at once can't both miss
 * that the checklist is now complete.
 */
export async function transitionTask(actor: AuthUser, id: string, action: TaskAction, today = todayInDhaka()) {
  asUuid(id, "Task");
  const visible = await prisma.onboardingTask.findFirst({ where: { AND: [{ id }, scopeVisibleTasks(actor)] }, select: { id: true, instanceId: true } });
  if (!visible) throw notFound("Task");

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM onboarding_instances WHERE id = ${visible.instanceId}::uuid FOR UPDATE`;
    const task = await tx.onboardingTask.findUniqueOrThrow({ where: { id }, include: taskInclude });
    const result = checkTaskTransition(
      action,
      { status: task.status, blocked: isBlocked(factsOf(task)), waitingFor: task.dependsOn?.title, ownerType: task.ownerType, ownerDepartmentId: task.ownerDepartmentId, assigneeId: task.assigneeId },
      toTaskActor(actor),
    );
    if (!result.ok) throw new ApiError("INVALID_TRANSITION", result.message);

    const { count } = await tx.onboardingTask.updateMany({
      where: { id, status: result.from },
      data: result.to === "COMPLETED" ? { status: "COMPLETED", completedAt: new Date(), completedById: actor.id } : { status: result.to },
    });
    if (count === 0) throw new ApiError("INVALID_TRANSITION", "This task was changed by someone else. Reload and try again.");

    if (result.to === "COMPLETED") {
      const remaining = await tx.onboardingTask.count({ where: { instanceId: task.instanceId, status: { not: "COMPLETED" } } });
      if (remaining === 0) await tx.onboardingInstance.update({ where: { id: task.instanceId }, data: { status: "COMPLETED" } });
    }
  });

  const fresh = await prisma.onboardingTask.findUniqueOrThrow({ where: { id }, include: { ...taskInclude, instance: { select: { status: true } } } });
  return { ...serializeTask(fresh, today, actor), instanceStatus: fresh.instance.status };
}
