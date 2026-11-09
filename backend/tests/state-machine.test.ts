import { describe, expect, it } from "vitest";
import type { RequestStatus } from "@/generated/prisma/client";
import {
  allowedActions, checkTransition,
  type Actor, type AssigneeCandidate, type RequestAction, type RequestState,
} from "@/services/state-machine";

const DEPT = "dept-it";
const OTHER_DEPT = "dept-ops";
const STATUSES: RequestStatus[] = ["SUBMITTED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const ACTIONS: RequestAction[] = ["assign", "start", "resolve", "close"];

const ACTORS = {
  requester: { id: "requester", role: "EMPLOYEE", headOfDepartmentId: null },
  assignee: { id: "assignee", role: "EMPLOYEE", headOfDepartmentId: null },
  head: { id: "head", role: "MANAGER", headOfDepartmentId: DEPT },
  otherHead: { id: "other-head", role: "MANAGER", headOfDepartmentId: OTHER_DEPT },
  reportsManager: { id: "mgr", role: "MANAGER", headOfDepartmentId: null },
  hr: { id: "hr", role: "HR_ADMIN", headOfDepartmentId: null },
  stranger: { id: "stranger", role: "EMPLOYEE", headOfDepartmentId: null },
} satisfies Record<string, Actor>;
type ActorName = keyof typeof ACTORS;

const request = (status: RequestStatus, over: Partial<RequestState> = {}): RequestState => ({
  status,
  requesterId: "requester",
  assigneeId: status === "SUBMITTED" ? null : "assignee",
  handlingDepartmentId: DEPT,
  ...over,
});

const goodAssignee: AssigneeCandidate = { id: "new-assignee", departmentId: DEPT, status: "ACTIVE" };

// ── Independent oracle: spec §6.1 written as two plain tables ─────────────────
const STATES_ALLOWING: Record<RequestAction, RequestStatus[]> = {
  assign: ["SUBMITTED", "ASSIGNED", "IN_PROGRESS"],
  start: ["ASSIGNED"],
  resolve: ["IN_PROGRESS"],
  close: ["RESOLVED"],
};
const ACTORS_ALLOWED: Record<RequestAction, ActorName[]> = {
  assign: ["head", "hr"],
  start: ["assignee"],
  resolve: ["assignee"],
  close: ["requester", "hr"],
};
const TARGET: Record<RequestAction, RequestStatus> = {
  assign: "ASSIGNED", start: "IN_PROGRESS", resolve: "RESOLVED", close: "CLOSED",
};

describe("reassigning a request that is in progress", () => {
  const inProgress = (over: Partial<RequestState> = {}) => request("IN_PROGRESS", { assigneeId: "assignee", ...over });

  it("sends it back to Assigned with the new assignee, so they start it themselves", () => {
    expect(checkTransition("assign", inProgress(), ACTORS.head, goodAssignee)).toEqual({ ok: true, from: "IN_PROGRESS", to: "ASSIGNED", assigneeId: "new-assignee" });
    expect(checkTransition("assign", inProgress(), ACTORS.hr, goodAssignee)).toMatchObject({ ok: true, to: "ASSIGNED" });
  });

  it("is not for the assignee, the requester or another department's head", () => {
    for (const who of ["assignee", "requester", "otherHead", "stranger"] as const) {
      expect(checkTransition("assign", inProgress(), ACTORS[who], goodAssignee)).toMatchObject({ ok: false, reason: "not_permitted" });
    }
  });

  it("must go to a different person, an active member of the handling department", () => {
    const samePerson = { ...goodAssignee, id: "assignee" };
    expect(checkTransition("assign", inProgress(), ACTORS.head, samePerson)).toMatchObject({ ok: false, reason: "invalid_assignee" });
    expect(checkTransition("assign", inProgress(), ACTORS.head, { ...goodAssignee, departmentId: OTHER_DEPT })).toMatchObject({ ok: false, reason: "invalid_assignee" });
    expect(checkTransition("assign", inProgress(), ACTORS.head, { ...goodAssignee, status: "ON_NOTICE" })).toMatchObject({ ok: false, reason: "invalid_assignee" });
    // Reassigning an ASSIGNED request to the same person is still harmless and allowed.
    expect(checkTransition("assign", request("ASSIGNED", { assigneeId: "assignee" }), ACTORS.head, { ...goodAssignee, id: "assignee" })).toMatchObject({ ok: true });
  });
});

describe("checkTransition: full action × status × actor matrix", () => {
  for (const action of ACTIONS) {
    for (const status of STATUSES) {
      for (const [name, actor] of Object.entries(ACTORS) as [ActorName, Actor][]) {
        const stateOk = STATES_ALLOWING[action].includes(status);
        const actorOk = ACTORS_ALLOWED[action].includes(name);
        it(`${action} on ${status} by ${name} → ${stateOk && actorOk ? "allowed" : stateOk ? "not_permitted" : "invalid_state"}`, () => {
          const result = checkTransition(action, request(status), actor, action === "assign" ? goodAssignee : undefined);
          if (stateOk && actorOk) {
            expect(result).toMatchObject({ ok: true, from: status, to: TARGET[action] });
          } else {
            expect(result).toMatchObject({ ok: false, reason: stateOk ? "not_permitted" : "invalid_state" });
          }
        });
      }
    }
  }
});

describe("checkTransition: specific rules", () => {
  it("reports the wrong state before the wrong actor", () => {
    expect(checkTransition("close", request("SUBMITTED"), ACTORS.stranger)).toMatchObject({ reason: "invalid_state" });
  });

  it("lets only the assignee start and resolve, with no HR override", () => {
    expect(checkTransition("start", request("ASSIGNED"), ACTORS.hr)).toMatchObject({ ok: false, reason: "not_permitted" });
    expect(checkTransition("resolve", request("IN_PROGRESS"), ACTORS.hr)).toMatchObject({ ok: false, reason: "not_permitted" });
  });

  it("lets an HR Admin who is the assignee start and resolve", () => {
    const hrAssigned = (s: RequestStatus) => request(s, { assigneeId: "hr" });
    expect(checkTransition("start", hrAssigned("ASSIGNED"), ACTORS.hr)).toMatchObject({ ok: true });
    expect(checkTransition("resolve", hrAssigned("IN_PROGRESS"), ACTORS.hr)).toMatchObject({ ok: true });
  });

  it("does not let a department head assign requests of another department", () => {
    expect(checkTransition("assign", request("SUBMITTED"), ACTORS.otherHead, goodAssignee)).toMatchObject({ reason: "not_permitted" });
  });

  it("lets a closed request go nowhere", () => {
    for (const action of ACTIONS) {
      for (const name of Object.keys(ACTORS) as ActorName[]) {
        expect(checkTransition(action, request("CLOSED"), ACTORS[name], goodAssignee)).toMatchObject({ ok: false, reason: "invalid_state" });
      }
    }
  });

  it("keeps the assignee on start, resolve and close", () => {
    expect(checkTransition("start", request("ASSIGNED"), ACTORS.assignee)).toMatchObject({ ok: true, assigneeId: "assignee" });
    expect(checkTransition("close", request("RESOLVED"), ACTORS.requester)).toMatchObject({ ok: true, assigneeId: "assignee" });
  });
});

describe("checkTransition: assign validation", () => {
  const assign = (assignee?: AssigneeCandidate | null, status: RequestStatus = "SUBMITTED") =>
    checkTransition("assign", request(status), ACTORS.head, assignee);

  it("assigns an active member of the handling department and sets the assignee", () => {
    expect(assign(goodAssignee)).toEqual({ ok: true, from: "SUBMITTED", to: "ASSIGNED", assigneeId: "new-assignee" });
  });

  it("accepts a member on probation", () => {
    expect(assign({ ...goodAssignee, status: "ON_PROBATION" })).toMatchObject({ ok: true });
  });

  it("rejects a missing assignee", () => {
    expect(assign(undefined)).toMatchObject({ ok: false, reason: "invalid_assignee" });
    expect(assign(null)).toMatchObject({ ok: false, reason: "invalid_assignee" });
  });

  it("rejects someone from another department", () => {
    expect(assign({ ...goodAssignee, departmentId: OTHER_DEPT })).toMatchObject({ ok: false, reason: "invalid_assignee" });
  });

  it("rejects someone on notice", () => {
    expect(assign({ ...goodAssignee, status: "ON_NOTICE" })).toMatchObject({ ok: false, reason: "invalid_assignee" });
  });

  it("reassigns an ASSIGNED request to a different person, staying ASSIGNED", () => {
    expect(assign(goodAssignee, "ASSIGNED")).toEqual({ ok: true, from: "ASSIGNED", to: "ASSIGNED", assigneeId: "new-assignee" });
  });

  it("checks the actor before the assignee", () => {
    const r = checkTransition("assign", request("SUBMITTED"), ACTORS.stranger, null);
    expect(r).toMatchObject({ reason: "not_permitted" });
  });
});

describe("allowedActions", () => {
  const actions = (status: RequestStatus, actor: ActorName, over: Partial<RequestState> = {}) =>
    allowedActions(request(status, over), ACTORS[actor]);

  it.each([
    ["SUBMITTED", "head", ["assign"]],
    ["SUBMITTED", "hr", ["assign"]],
    ["SUBMITTED", "requester", []],
    ["SUBMITTED", "otherHead", []],
    ["ASSIGNED", "assignee", ["start"]],
    ["ASSIGNED", "head", ["assign"]],
    ["ASSIGNED", "hr", ["assign"]],
    ["ASSIGNED", "requester", []],
    ["IN_PROGRESS", "assignee", ["resolve"]],
    ["IN_PROGRESS", "head", ["assign"]],
    ["IN_PROGRESS", "hr", ["assign"]],
    ["IN_PROGRESS", "otherHead", []],
    ["IN_PROGRESS", "requester", []],
    ["RESOLVED", "requester", ["close"]],
    ["RESOLVED", "hr", ["close"]],
    ["RESOLVED", "assignee", []],
    ["CLOSED", "hr", []],
    ["CLOSED", "requester", []],
  ] as [RequestStatus, ActorName, RequestAction[]][])("%s as %s → %j", (status, actor, expected) => {
    expect(actions(status, actor)).toEqual(expected);
  });

  it("can offer several actions at once", () => {
    // The head is also the assignee and the requester of a request that is assigned to them.
    const both = allowedActions(request("ASSIGNED", { assigneeId: "head", requesterId: "head" }), ACTORS.head);
    expect(both.sort()).toEqual(["assign", "start"]);
  });

  it("agrees with checkTransition for every combination", () => {
    for (const status of STATUSES) {
      for (const [name, actor] of Object.entries(ACTORS) as [ActorName, Actor][]) {
        const offered = allowedActions(request(status), actor);
        for (const action of ACTIONS) {
          const ok = checkTransition(action, request(status), actor, goodAssignee).ok;
          expect(offered.includes(action), `${action}/${status}/${name}`).toBe(ok);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding tasks (spec §6.2)
// ─────────────────────────────────────────────────────────────────────────────
import {
  allowedTaskActions, checkTaskAssign, checkTaskTransition, isTaskOwner,
  type TaskAction, type TaskActor, type TaskAssignee, type TaskState,
} from "@/services/state-machine";
import type { OnboardingTaskStatus } from "@/generated/prisma/client";

describe("onboarding task state machine", () => {
  const IT = "dept-it";
  const PEOPLE = "dept-people";
  const TASK_ACTORS = {
    itHead: { id: "ithead", role: "MANAGER", departmentId: IT, headOfDepartmentId: IT },
    itMember: { id: "it1", role: "EMPLOYEE", departmentId: IT, headOfDepartmentId: null }, // the assignee in the "assigned" cases
    itOther: { id: "it2", role: "EMPLOYEE", departmentId: IT, headOfDepartmentId: null },
    peopleMember: { id: "p1", role: "EMPLOYEE", departmentId: PEOPLE, headOfDepartmentId: null },
    peopleHead: { id: "peoplehead", role: "MANAGER", departmentId: PEOPLE, headOfDepartmentId: PEOPLE },
    hiresManager: { id: "mgr", role: "MANAGER", departmentId: PEOPLE, headOfDepartmentId: null },
    otherManager: { id: "mgr2", role: "MANAGER", departmentId: "dept-ops", headOfDepartmentId: null },
    hr: { id: "hr", role: "HR_ADMIN", departmentId: PEOPLE, headOfDepartmentId: null },
  } satisfies Record<string, TaskActor>;
  type Who = keyof typeof TASK_ACTORS;
  const TASK_STATUSES: OnboardingTaskStatus[] = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"];
  const TASK_ACTIONS: TaskAction[] = ["start", "complete"];

  const deptTask = (status: OnboardingTaskStatus, blocked = false, assigneeId: string | null = null): TaskState => ({
    status, blocked, waitingFor: blocked ? "Create accounts" : null, ownerType: "DEPARTMENT", ownerDepartmentId: IT, assigneeId,
  });
  const managerTask = (status: OnboardingTaskStatus, blocked = false): TaskState => ({
    status, blocked, waitingFor: blocked ? "Create accounts" : null, ownerType: "MANAGER", ownerDepartmentId: null, assigneeId: "mgr",
  });

  // Oracle written as plain tables.
  const STATE_OK: Record<TaskAction, OnboardingTaskStatus[]> = { start: ["NOT_STARTED"], complete: ["NOT_STARTED", "IN_PROGRESS"] };
  const TARGET: Record<TaskAction, OnboardingTaskStatus> = { start: "IN_PROGRESS", complete: "COMPLETED" };
  // Department task: the head of the owning department, and whoever the head assigned it to. Nobody else, HR included
  // (HR is in People & Culture here, and even an HR Admin who heads or is assigned would act as that person, not as HR).
  const CASES = [
    ["unassigned department task", (s: OnboardingTaskStatus, b: boolean) => deptTask(s, b), ["itHead"]],
    ["assigned department task", (s: OnboardingTaskStatus, b: boolean) => deptTask(s, b, "it1"), ["itHead", "itMember"]],
    ["manager task", managerTask, ["hiresManager"]],
  ] as const;

  for (const [label, make, owners] of CASES) {
    describe(label, () => {
      for (const action of TASK_ACTIONS) {
        for (const status of TASK_STATUSES) {
          for (const blocked of [false, true]) {
            for (const [who, actor] of Object.entries(TASK_ACTORS) as [Who, TaskActor][]) {
              const stateOk = STATE_OK[action].includes(status);
              const ownerOk = (owners as readonly string[]).includes(who);
              const expected = !stateOk ? "invalid_state" : !ownerOk ? "not_permitted" : blocked ? "blocked" : "ok";
              it(`${action} ${status}${blocked ? " (blocked)" : ""} by ${who} → ${expected}`, () => {
                const r = checkTaskTransition(action, make(status, blocked), actor);
                if (expected === "ok") expect(r).toEqual({ ok: true, from: status, to: TARGET[action] });
                else expect(r).toMatchObject({ ok: false, reason: expected });
              });
            }
          }
        }
      }
    });
  }

  it("names the task a blocked task is waiting for", () => {
    const r = checkTaskTransition("start", deptTask("NOT_STARTED", true), TASK_ACTORS.itHead);
    expect(r).toMatchObject({ ok: false, reason: "blocked", message: expect.stringContaining("Create accounts") });
  });

  it("does not reveal blocking to people who couldn't act anyway", () => {
    expect(checkTaskTransition("start", deptTask("NOT_STARTED", true), TASK_ACTORS.itOther)).toMatchObject({ reason: "not_permitted" });
  });

  it("a completed task offers nothing to start or complete, to anyone", () => {
    for (const actor of Object.values(TASK_ACTORS)) {
      for (const t of [deptTask("COMPLETED"), deptTask("COMPLETED", false, "it1"), managerTask("COMPLETED")]) {
        expect(allowedTaskActions(t, actor)).toEqual([]);
      }
    }
  });

  it("allowedTaskActions: the head can work and assign; the assignee can only work; others get nothing", () => {
    expect(allowedTaskActions(deptTask("NOT_STARTED"), TASK_ACTORS.itHead)).toEqual(["start", "complete", "assign"]);
    expect(allowedTaskActions(deptTask("IN_PROGRESS", false, "it1"), TASK_ACTORS.itHead)).toEqual(["complete", "assign"]);
    expect(allowedTaskActions(deptTask("NOT_STARTED", false, "it1"), TASK_ACTORS.itMember)).toEqual(["start", "complete"]);
    expect(allowedTaskActions(deptTask("IN_PROGRESS", false, "it1"), TASK_ACTORS.itMember)).toEqual(["complete"]);
    expect(allowedTaskActions(deptTask("NOT_STARTED", true), TASK_ACTORS.itHead)).toEqual(["assign"]); // blocked: can't work, can still assign
    expect(allowedTaskActions(deptTask("NOT_STARTED"), TASK_ACTORS.itOther)).toEqual([]);
    expect(allowedTaskActions(deptTask("NOT_STARTED"), TASK_ACTORS.peopleHead)).toEqual([]);
    expect(allowedTaskActions(deptTask("NOT_STARTED", false, "it1"), TASK_ACTORS.itOther)).toEqual([]);
  });

  it("HR Admin can assign a department task but never works it, and has no actions on a manager task", () => {
    expect(allowedTaskActions(deptTask("NOT_STARTED"), TASK_ACTORS.hr)).toEqual(["assign"]);
    expect(allowedTaskActions(deptTask("NOT_STARTED", false, "it1"), TASK_ACTORS.hr)).toEqual(["assign"]);
    expect(allowedTaskActions(managerTask("NOT_STARTED"), TASK_ACTORS.hr)).toEqual([]);
  });

  it("manager tasks are not assignable by anyone, the hire's manager included", () => {
    for (const actor of Object.values(TASK_ACTORS)) expect(allowedTaskActions(managerTask("NOT_STARTED"), actor)).not.toContain("assign");
  });

  it("task ownership: the owning department's head, the assignee, and the assigned manager", () => {
    expect(isTaskOwner(deptTask("NOT_STARTED"), TASK_ACTORS.itHead)).toBe(true);
    expect(isTaskOwner(deptTask("NOT_STARTED"), TASK_ACTORS.itMember)).toBe(false); // same department, but not assigned
    expect(isTaskOwner(deptTask("NOT_STARTED", false, "it1"), TASK_ACTORS.itMember)).toBe(true);
    expect(isTaskOwner(deptTask("NOT_STARTED", false, "it1"), TASK_ACTORS.itOther)).toBe(false);
    expect(isTaskOwner(deptTask("NOT_STARTED"), TASK_ACTORS.peopleHead)).toBe(false); // head of another department
    expect(isTaskOwner(deptTask("NOT_STARTED"), TASK_ACTORS.hr)).toBe(false);
    expect(isTaskOwner(managerTask("NOT_STARTED"), TASK_ACTORS.hiresManager)).toBe(true);
    expect(isTaskOwner(managerTask("NOT_STARTED"), TASK_ACTORS.otherManager)).toBe(false);
    expect(isTaskOwner(managerTask("NOT_STARTED"), TASK_ACTORS.hr)).toBe(false);
  });

  it("an HR Admin who is the assigned person owns that task", () => {
    expect(isTaskOwner({ ...managerTask("NOT_STARTED"), assigneeId: TASK_ACTORS.hr.id }, TASK_ACTORS.hr)).toBe(true);
    expect(isTaskOwner(deptTask("NOT_STARTED", false, TASK_ACTORS.hr.id), TASK_ACTORS.hr)).toBe(true);
  });

  describe("assigning", () => {
    const member = (over: Partial<TaskAssignee> = {}): TaskAssignee => ({ id: "it1", departmentId: IT, status: "ACTIVE", ...over });
    const assign = (task: TaskState, actor: TaskActor, candidate: TaskAssignee | null = member()) => checkTaskAssign(task, actor, candidate);

    it("the head and HR Admin can assign an unfinished department task to an active member", () => {
      for (const who of ["itHead", "hr"] as const) {
        for (const status of ["NOT_STARTED", "IN_PROGRESS"] as const) {
          expect(assign(deptTask(status), TASK_ACTORS[who])).toMatchObject({ ok: true, assigneeId: "it1" });
        }
      }
    });

    it("nobody else may: members, assignee, another department's head, the hire's manager", () => {
      for (const who of ["itMember", "itOther", "peopleHead", "peopleMember", "hiresManager", "otherManager"] as const) {
        expect(assign(deptTask("NOT_STARTED", false, "it1"), TASK_ACTORS[who], member({ id: "it2" }))).toMatchObject({ ok: false, reason: "not_permitted" });
      }
    });

    it("a completed task cannot be assigned (409), and neither can a manager task", () => {
      expect(assign(deptTask("COMPLETED"), TASK_ACTORS.itHead)).toMatchObject({ ok: false, reason: "invalid_state" });
      expect(assign(managerTask("NOT_STARTED"), TASK_ACTORS.hr, member())).toMatchObject({ ok: false, reason: "invalid_state" });
    });

    it("the assignee must exist, be in the owning department and be active or on probation", () => {
      expect(assign(deptTask("NOT_STARTED"), TASK_ACTORS.itHead, null)).toMatchObject({ ok: false, reason: "invalid_assignee" });
      expect(assign(deptTask("NOT_STARTED"), TASK_ACTORS.itHead, member({ departmentId: PEOPLE }))).toMatchObject({ ok: false, reason: "invalid_assignee" });
      expect(assign(deptTask("NOT_STARTED"), TASK_ACTORS.itHead, member({ status: "ON_NOTICE" }))).toMatchObject({ ok: false, reason: "invalid_assignee" });
      expect(assign(deptTask("NOT_STARTED"), TASK_ACTORS.itHead, member({ status: "ON_PROBATION" }))).toMatchObject({ ok: true });
    });

    it("the head may assign a task to themself", () => {
      expect(assign(deptTask("NOT_STARTED"), TASK_ACTORS.itHead, member({ id: "ithead" }))).toMatchObject({ ok: true, assigneeId: "ithead" });
    });

    it("assigning the person who already has it is refused (422)", () => {
      expect(assign(deptTask("NOT_STARTED", false, "it1"), TASK_ACTORS.itHead)).toMatchObject({ ok: false, reason: "invalid_assignee" });
      expect(assign(deptTask("IN_PROGRESS", false, "it1"), TASK_ACTORS.itHead)).toMatchObject({ ok: false, reason: "invalid_assignee" });
    });

    it("handing an In Progress task to someone else sends it back to Not Started; a Not Started one stays", () => {
      expect(assign(deptTask("IN_PROGRESS", false, "it2"), TASK_ACTORS.itHead)).toMatchObject({ ok: true, to: "NOT_STARTED" });
      expect(assign(deptTask("NOT_STARTED", false, "it2"), TASK_ACTORS.itHead)).toMatchObject({ ok: true, to: "NOT_STARTED" });
    });

    it("a blocked task can still be assigned", () => {
      expect(assign(deptTask("NOT_STARTED", true), TASK_ACTORS.itHead)).toMatchObject({ ok: true });
    });
  });
});
