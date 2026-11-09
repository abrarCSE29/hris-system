import type { OnboardingTaskStatus, OwnerType, RequestStatus } from "@/generated/prisma/client";
import type { RoleCode, StatusCode } from "@/lib/lookups";

/**
 * Service-request workflow (spec §6.1). Pure functions: no database access, so the whole
 * transition table can be tested exhaustively. The route loads the data and applies the result.
 */

export type RequestAction = "assign" | "start" | "resolve" | "close";

export interface Actor {
  id: string;
  /** The role's `code`. Callers pass `user.role.code`; this module stays free of database shapes. */
  role: RoleCode;
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
  /** The status's `code`. */
  status: StatusCode;
}

interface Rule {
  from: RequestStatus[];
  to: RequestStatus;
  who: (req: RequestState, actor: Actor) => boolean;
}

const isHr = (a: Actor) => a.role === "HR_ADMIN";

export const REQUEST_TRANSITIONS: Record<RequestAction, Rule> = {
  // Manager of the handling department, or HR Admin. Also used to reassign, including a request that is already in
  // progress (the person working on it may be unavailable or the wrong fit). A reassigned request goes back to
  // Assigned: the new assignee starts it themselves.
  assign: {
    from: ["SUBMITTED", "ASSIGNED", "IN_PROGRESS"],
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

export const ASSIGNABLE_STATUSES: StatusCode[] = ["ACTIVE", "ON_PROBATION"];

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
    // Handing work that is already under way to the person doing it would only throw away its In Progress status.
    if (req.status === "IN_PROGRESS" && assignee.id === req.assigneeId) {
      return { ok: false, reason: "invalid_assignee", message: "That person is already working on this request" };
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
  /** The role's `code`. Callers pass `user.role.code`; this module stays free of database shapes. */
  role: RoleCode;
  departmentId: string;
  /** Department this user heads, if any. */
  headOfDepartmentId: string | null;
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

const isHeadOfOwner = (task: Pick<TaskState, "ownerDepartmentId">, actor: TaskActor) =>
  task.ownerDepartmentId !== null && actor.headOfDepartmentId === task.ownerDepartmentId;

/**
 * Task owner (who may start / complete). A DEPARTMENT task is worked by the head of the owning department (who handles
 * it directly or delegates) and by whoever the head assigned it to; other members of the department are not owners.
 * A MANAGER task is worked by the assigned manager. There is no HR Admin override: HR can see every task and assign
 * department tasks, but works only the tasks assigned to them.
 */
export function isTaskOwner(task: Pick<TaskState, "ownerType" | "ownerDepartmentId" | "assigneeId">, actor: TaskActor): boolean {
  if (task.assigneeId === actor.id) return true;
  return task.ownerType === "DEPARTMENT" && isHeadOfOwner(task, actor);
}

/** Who may hand a department task to someone: the head of the owning department, or HR Admin (covers a department with no head). */
const canAssignTask = (task: TaskState, actor: TaskActor) =>
  task.ownerType === "DEPARTMENT" && (actor.role === "HR_ADMIN" || isHeadOfOwner(task, actor));

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

/** The person a task is being assigned to. */
export interface TaskAssignee {
  id: string;
  departmentId: string;
  /** The status's `code`. */
  status: StatusCode;
}

export type TaskAssignResult =
  | { ok: true; from: OnboardingTaskStatus; to: OnboardingTaskStatus; assigneeId: string }
  | { ok: false; reason: "invalid_state" | "not_permitted" | "invalid_assignee"; message: string };

/**
 * Assigns (or reassigns) a department task. Same rules as assigning a service request: head of the owning department
 * or HR Admin; the assignee must be an active member of that department; handing an In Progress task to someone else
 * sends it back to Not Started so the new person starts it themselves. A blocked task can be assigned ahead of time.
 */
export function checkTaskAssign(task: TaskState, actor: TaskActor, assignee: TaskAssignee | null): TaskAssignResult {
  if (task.ownerType !== "DEPARTMENT") {
    return { ok: false, reason: "invalid_state", message: "This task belongs to the new hire's manager and cannot be assigned" };
  }
  if (task.status === "COMPLETED") return { ok: false, reason: "invalid_state", message: "Cannot assign a task that is COMPLETED" };
  if (!canAssignTask(task, actor)) return { ok: false, reason: "not_permitted", message: "You are not allowed to assign this task" };
  if (!assignee) return { ok: false, reason: "invalid_assignee", message: "An assignee is required" };
  if (assignee.departmentId !== task.ownerDepartmentId || !ASSIGNABLE_STATUSES.includes(assignee.status)) {
    return { ok: false, reason: "invalid_assignee", message: "Assignee must be an active member of the owning department" };
  }
  if (assignee.id === task.assigneeId) return { ok: false, reason: "invalid_assignee", message: "That person already has this task" };
  return { ok: true, from: task.status, to: "NOT_STARTED", assigneeId: assignee.id };
}

/** Actions this person could attempt right now (drives the buttons). Blocked, finished and not-yours tasks offer none to work. */
export function allowedTaskActions(task: TaskState, actor: TaskActor): (TaskAction | "assign")[] {
  const work = (Object.keys(TASK_RULES) as TaskAction[]).filter((a) => checkTaskTransition(a, task, actor).ok);
  return task.status !== "COMPLETED" && canAssignTask(task, actor) ? [...work, "assign"] : work;
}
