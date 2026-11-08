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
import { allowedTaskActions, checkTaskTransition, isTaskOwner, type TaskAction, type TaskActor, type TaskState } from "@/services/state-machine";
import type { OnboardingTaskStatus } from "@/generated/prisma/client";

describe("onboarding task state machine", () => {
  const IT = "dept-it";
  const PEOPLE = "dept-people";
  const TASK_ACTORS = {
    itMember: { id: "it1", role: "EMPLOYEE", departmentId: IT },
    peopleMember: { id: "p1", role: "EMPLOYEE", departmentId: PEOPLE },
    hiresManager: { id: "mgr", role: "MANAGER", departmentId: PEOPLE },
    otherManager: { id: "mgr2", role: "MANAGER", departmentId: "dept-ops" },
    hr: { id: "hr", role: "HR_ADMIN", departmentId: PEOPLE },
    theHire: { id: "hire", role: "EMPLOYEE", departmentId: IT },
  } satisfies Record<string, TaskActor>;
  type Who = keyof typeof TASK_ACTORS;
  const TASK_STATUSES: OnboardingTaskStatus[] = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"];
  const TASK_ACTIONS: TaskAction[] = ["start", "complete"];

  const deptTask = (status: OnboardingTaskStatus, blocked = false): TaskState => ({
    status, blocked, waitingFor: blocked ? "Create accounts" : null, ownerType: "DEPARTMENT", ownerDepartmentId: IT, assigneeId: null,
  });
  const managerTask = (status: OnboardingTaskStatus, blocked = false): TaskState => ({
    status, blocked, waitingFor: blocked ? "Create accounts" : null, ownerType: "MANAGER", ownerDepartmentId: null, assigneeId: "mgr",
  });

  // Oracle written as plain tables.
  const STATE_OK: Record<TaskAction, OnboardingTaskStatus[]> = { start: ["NOT_STARTED"], complete: ["NOT_STARTED", "IN_PROGRESS"] };
  // No HR override: HR is in People & Culture here, so they own People tasks but not IT or manager tasks.
  const DEPT_OWNERS: Who[] = ["itMember", "theHire"]; // theHire happens to be in IT: department membership is what counts
  const MANAGER_OWNERS: Who[] = ["hiresManager"];
  const TARGET: Record<TaskAction, OnboardingTaskStatus> = { start: "IN_PROGRESS", complete: "COMPLETED" };

  for (const [label, make, owners] of [["department task", deptTask, DEPT_OWNERS], ["manager task", managerTask, MANAGER_OWNERS]] as const) {
    describe(label, () => {
      for (const action of TASK_ACTIONS) {
        for (const status of TASK_STATUSES) {
          for (const blocked of [false, true]) {
            for (const [who, actor] of Object.entries(TASK_ACTORS) as [Who, TaskActor][]) {
              const stateOk = STATE_OK[action].includes(status);
              const ownerOk = owners.includes(who);
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
    const r = checkTaskTransition("start", deptTask("NOT_STARTED", true), TASK_ACTORS.itMember);
    expect(r).toMatchObject({ ok: false, reason: "blocked", message: expect.stringContaining("Create accounts") });
  });

  it("does not reveal blocking to people who couldn't act anyway", () => {
    expect(checkTaskTransition("start", deptTask("NOT_STARTED", true), TASK_ACTORS.peopleMember)).toMatchObject({ reason: "not_permitted" });
  });

  it("a completed task offers nothing, to anyone", () => {
    for (const actor of Object.values(TASK_ACTORS)) {
      expect(allowedTaskActions(deptTask("COMPLETED"), actor)).toEqual([]);
      expect(allowedTaskActions(managerTask("COMPLETED"), actor)).toEqual([]);
    }
  });

  it("allowedTaskActions offers start+complete, then only complete, and nothing while blocked", () => {
    expect(allowedTaskActions(deptTask("NOT_STARTED"), TASK_ACTORS.itMember)).toEqual(["start", "complete"]);
    expect(allowedTaskActions(deptTask("IN_PROGRESS"), TASK_ACTORS.itMember)).toEqual(["complete"]);
    expect(allowedTaskActions(deptTask("NOT_STARTED", true), TASK_ACTORS.itMember)).toEqual([]);
    expect(allowedTaskActions(deptTask("NOT_STARTED"), TASK_ACTORS.peopleMember)).toEqual([]);
  });

  it("task ownership: department members, the assigned manager, and HR", () => {
    expect(isTaskOwner(deptTask("NOT_STARTED"), TASK_ACTORS.itMember)).toBe(true);
    expect(isTaskOwner(deptTask("NOT_STARTED"), TASK_ACTORS.hiresManager)).toBe(false);
    expect(isTaskOwner(managerTask("NOT_STARTED"), TASK_ACTORS.hiresManager)).toBe(true);
    expect(isTaskOwner(managerTask("NOT_STARTED"), TASK_ACTORS.otherManager)).toBe(false);
    // HR Admin has no override on tasks they don't own…
    expect(isTaskOwner(managerTask("NOT_STARTED"), TASK_ACTORS.hr)).toBe(false);
    expect(isTaskOwner(deptTask("NOT_STARTED"), TASK_ACTORS.hr)).toBe(false);
  });

  it("…but an HR Admin owns the tasks of the department they work in, like anyone else there", () => {
    const peopleTask: TaskState = { status: "NOT_STARTED", blocked: false, ownerType: "DEPARTMENT", ownerDepartmentId: PEOPLE, assigneeId: null };
    expect(isTaskOwner(peopleTask, TASK_ACTORS.hr)).toBe(true);
    expect(allowedTaskActions(peopleTask, TASK_ACTORS.hr)).toEqual(["start", "complete"]);
    expect(allowedTaskActions(peopleTask, TASK_ACTORS.itMember)).toEqual([]);
  });

  it("an HR Admin who is the assigned manager owns that manager task", () => {
    const task: TaskState = { ...managerTask("NOT_STARTED"), assigneeId: TASK_ACTORS.hr.id };
    expect(isTaskOwner(task, TASK_ACTORS.hr)).toBe(true);
  });
});
