import type { OnboardingTaskStatus, OwnerType, RequestStatus, Role, UserStatus } from "@/generated/prisma/client";

/**
 * Service-request workflow (spec §6.1). Pure functions: no database access, so the whole
 * transition table can be tested exhaustively. The route loads the data and applies the result.
 */

export type RequestAction = "assign" | "start" | "resolve" | "close";

export interface Actor {
  id: string;
  role: Role;
  /** Department this user heads, if any. */
  headOfDepartmentId: string | null;
}

export interface RequestState {
  status: RequestStatus;
  requesterId: string;
  assigneeId: string | null;
  handlingDepartmentId: string;
}

/** The person being assigned (only needed for the `assign` action). */
export interface AssigneeCandidate {
  id: string;
  departmentId: string;
  status: UserStatus;
}

interface Rule {
  from: RequestStatus[];
  to: RequestStatus;
  who: (req: RequestState, actor: Actor) => boolean;
}

const isHr = (a: Actor) => a.role === "HR_ADMIN";

export const REQUEST_TRANSITIONS: Record<RequestAction, Rule> = {
  // Head of the handling department, or HR Admin. Also used to reassign.
  assign: {
    from: ["SUBMITTED", "ASSIGNED"],
    to: "ASSIGNED",
    who: (req, a) => isHr(a) || (a.headOfDepartmentId !== null && a.headOfDepartmentId === req.handlingDepartmentId),
  },
  // Only the assignee works the request. HR Admin has no override in v1.
  start: { from: ["ASSIGNED"], to: "IN_PROGRESS", who: (req, a) => req.assigneeId === a.id },
  resolve: { from: ["IN_PROGRESS"], to: "RESOLVED", who: (req, a) => req.assigneeId === a.id },
  close: { from: ["RESOLVED"], to: "CLOSED", who: (req, a) => req.requesterId === a.id || isHr(a) },
};

export type TransitionResult =
  | { ok: true; from: RequestStatus; to: RequestStatus; assigneeId: string | null }
  /** The action is not possible from the current status. */
  | { ok: false; reason: "invalid_state"; message: string }
  /** The status allows it, but not for this person. */
  | { ok: false; reason: "not_permitted"; message: string }
  /** `assign` needs a valid assignee (an active member of the handling department). */
  | { ok: false; reason: "invalid_assignee"; message: string };

export const ASSIGNABLE_STATUSES: UserStatus[] = ["ACTIVE", "ON_PROBATION"];

export function checkTransition(
  action: RequestAction,
  req: RequestState,
  actor: Actor,
  assignee?: AssigneeCandidate | null,
): TransitionResult {
  const rule = REQUEST_TRANSITIONS[action];
  if (!rule.from.includes(req.status)) {
    return { ok: false, reason: "invalid_state", message: `Cannot ${action} a request that is ${req.status}` };
  }
  if (!rule.who(req, actor)) {
    return { ok: false, reason: "not_permitted", message: `You are not allowed to ${action} this request` };
  }
  if (action === "assign") {
    if (!assignee) return { ok: false, reason: "invalid_assignee", message: "An assignee is required" };
    if (assignee.departmentId !== req.handlingDepartmentId || !ASSIGNABLE_STATUSES.includes(assignee.status)) {
      return {
        ok: false,
        reason: "invalid_assignee",
        message: "Assignee must be an active member of the handling department",
      };
    }
    return { ok: true, from: req.status, to: rule.to, assigneeId: assignee.id };
  }
  return { ok: true, from: req.status, to: rule.to, assigneeId: req.assigneeId };
}

/** Actions this person could attempt right now. Drives the buttons the UI shows. */
export function allowedActions(req: RequestState, actor: Actor): RequestAction[] {
  return (Object.keys(REQUEST_TRANSITIONS) as RequestAction[]).filter((action) => {
    const rule = REQUEST_TRANSITIONS[action];
    return rule.from.includes(req.status) && rule.who(req, actor);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding task workflow (spec §6.2)
// ─────────────────────────────────────────────────────────────────────────────

export type TaskAction = "start" | "complete";

export interface TaskActor {
  id: string;
  role: Role;
  departmentId: string;
}

export interface TaskState {
  status: OnboardingTaskStatus;
  /** Calculated: the task it depends on is not completed. */
  blocked: boolean;
  /** Title of the task it is waiting for, for the error message. */
  waitingFor?: string | null;
  ownerType: OwnerType;
  ownerDepartmentId: string | null;
  assigneeId: string | null;
}

/**
 * Task owner = a member of the owning department, or the assigned manager for MANAGER tasks. There is no HR Admin
 * override: HR can see every task but only acts on the ones they own, the same as service requests. (An HR Admin
 * who works in the owning department is a member of it, so is the owner of that department's tasks.)
 */
export function isTaskOwner(task: Pick<TaskState, "ownerType" | "ownerDepartmentId" | "assigneeId">, actor: TaskActor): boolean {
  if (task.ownerType === "DEPARTMENT") return task.ownerDepartmentId !== null && task.ownerDepartmentId === actor.departmentId;
  return task.assigneeId === actor.id;
}

const TASK_RULES: Record<TaskAction, { from: OnboardingTaskStatus[]; to: OnboardingTaskStatus }> = {
  start: { from: ["NOT_STARTED"], to: "IN_PROGRESS" },
  complete: { from: ["NOT_STARTED", "IN_PROGRESS"], to: "COMPLETED" },
};

export type TaskTransitionResult =
  | { ok: true; from: OnboardingTaskStatus; to: OnboardingTaskStatus }
  | { ok: false; reason: "invalid_state" | "not_permitted" | "blocked"; message: string };

/** Checks the status first, then who is asking, then whether the task is still waiting on another. */
export function checkTaskTransition(action: TaskAction, task: TaskState, actor: TaskActor): TaskTransitionResult {
  const rule = TASK_RULES[action];
  if (!rule.from.includes(task.status)) {
    return { ok: false, reason: "invalid_state", message: `Cannot ${action} a task that is ${task.status}` };
  }
  if (!isTaskOwner(task, actor)) {
    return { ok: false, reason: "not_permitted", message: `You are not allowed to ${action} this task` };
  }
  if (task.blocked) {
    return {
      ok: false,
      reason: "blocked",
      message: task.waitingFor ? `This task is blocked until "${task.waitingFor}" is completed` : "This task is blocked by an unfinished task",
    };
  }
  return { ok: true, from: task.status, to: rule.to };
}

/** Actions this person could take right now. Blocked, finished and not-yours tasks offer none. */
export function allowedTaskActions(task: TaskState, actor: TaskActor): TaskAction[] {
  return (Object.keys(TASK_RULES) as TaskAction[]).filter((a) => checkTaskTransition(a, task, actor).ok);
}
