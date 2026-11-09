# Spec: who works an onboarding task (department head assigns)

Status: **v1, for approval.** Source: the Module B brief ("tasks are pre-assigned to a department, not a specific person yet; the department manager sees all onboarding tasks for the department and handles them or delegates to a team member, **or** tasks go to a designated contact. Pick one, implement it, document why").
Related: `docs/architecture-v1.md` §4.5, §5 (permissions), §6.2, `backend/src/services/{onboarding,policy,state-machine}.ts`.

## The flaw today

A task owned by a department is visible to, and workable by, **every member** of that department. Nobody is ever responsible for it: in a 15-person department all 15 see the same task in their queue, anyone can complete it, and nobody can tell who is handling it. This is neither option in the brief. (A request already works the right way: the department's Manager sees it and assigns one member.)

## Decision: option 1, the department head triages

Reasons: it is the same rule as service requests (one way to route work in the product); it needs no new table or setting; `departments.head_id` already says who the Manager is (the seed has exactly one per department); a "designated contact" would add a setting that someone must keep current when people leave.

## Assumptions (correct me before approving)

1. **Task states of ownership.** A `DEPARTMENT` task starts **unassigned** (`assignee_id` null). The head of the owning department assigns it to one active member of that department (the head may assign it to themself). `MANAGER` tasks are unchanged: assigned to the hire's manager at creation.
2. **Who sees a department task in their queue** (`GET /onboarding/tasks`): the head of the owning department (all its tasks, assigned or not) and the assignee. Other members of the department no longer see it. HR Admin still sees every task (read only).
3. **Who may start / complete it:** the assignee, or the head of the owning department (handles it directly). Nobody else; HR Admin has no override, as before. A task nobody is assigned to can still be done by the head.
4. **Assign / reassign:** new `POST /onboarding/tasks/:id/assign` `{ assigneeId }`. Allowed for the head of the owning department and for HR Admin (same as requests; this covers a department with no head). The assignee must be an **active** member of the owning department (`422`, path `assigneeId`, otherwise). Allowed while the task is not completed (`409` after). It works on `MANAGER` tasks? **No** (`409`: those belong to the hire's manager). Reassigning an **In Progress** task sends it back to **Not Started** (same as requests), and the new assignee starts it. Assigning to the current assignee is `422`.
5. **Who can open a task by id:** unchanged (owners and anyone who can see the checklist), so the hire and their manager still see who is on each task.
6. **Responses:** each task already has `assignee`. It gains `allowedActions` including `assign` for the head and HR Admin, so the UI shows the button only to them. The task list for a head gets a "Needs an owner" filter (`?assigned=false`).
7. **Existing data:** tasks already created keep `assignee_id` null; the head sees them as unassigned and can assign or do them. No migration of data and **no schema change** (`assignee_id` exists).
8. **Frontend:** the task queue shows an Assignee column; the head gets an "Assign" control (member picker, as on requests); the hire's checklist shows "Assigned to <name>" or "Not assigned yet".
9. **Seed and docs:** the seed leaves department tasks unassigned except a few assigned ones, so every state is visible. `architecture-v1.md` §1.3, §4.5, §5, §6.2 and the role table are updated, with the reason for this choice.

## Commands

```
cd backend && npm test && npx tsc --noEmit
cd ../frontend && npx tsc --noEmit && npx vitest run
```

## Testing strategy (test first)

- **Rules (state machine):** the head and the assignee may start/complete; a plain member of the department, a head of another department and HR Admin may not; a task with no assignee can be done by the head only.
- **Queue scope:** head sees all department tasks; a member sees only theirs; before assignment a member sees none.
- **Assign:** head and HR Admin can; member and other-department head get `403`; assignee must be an active member (`422`); completed task `409`; `MANAGER` task `409`; reassign an In Progress task returns it to Not Started; each case checked against the database, not only the response.
- **Mutation checks:** drop the membership check, drop the head check, leave In Progress on reassign; each must fail a test.
- **Existing tests** that assumed "any member can complete" are rewritten to the new rule, not deleted.

## Boundaries

- **Always:** assignee must be an active member of the owning department; the check runs in the same transaction as the update.
- **Ask first:** a schema change; letting HR Admin start/complete tasks; notifications to the assignee.
- **Never:** let a member of another department act on or see another department's tasks in their queue.

## Success criteria

1. A new checklist's department tasks are unassigned and appear only in the head's queue.
2. The head can assign a task to a department member; the member then sees it, others do not, and only the member and the head can complete it.
3. Every other combination is refused as listed in the tests, shown by tests that fail when the rule is removed.
4. The architecture doc explains the choice and the new rules; backend and frontend tests and type-checks pass.

## Open questions

- Should the head's own tasks (the head is a member) be assignable to anyone else without extra steps? Assumed yes (rule 4).
- Is a notification to the assignee wanted? Not in this change (no notification system exists).
