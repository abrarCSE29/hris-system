# Spec: manager dashboard (team performance)

Status: **v3, for approval.** v3: the dashboard ignores department heads (your answer; existing behaviour elsewhere is unchanged). v2: Managers land on this page after login. Source: your request ("managers need a dashboard where they can see the performance of their own team") and your answers: team = **direct reports**; measures = **requests, onboarding tasks on time vs late, the team's own new hires, workload per person**; **totals plus a per-person table**; period = **last 30 days with a picker**.
Related: `docs/architecture-v1.md` §4.6 (HR dashboard), §5, `backend/src/services/{dashboard,policy,onboarding-logic}.ts`, `frontend/app/(app)/dashboard/page.tsx`.

## Objective

A Manager has no overview of their team today. They see direct reports' requests and checklists one by one, but cannot tell at a glance who is overloaded, what is late, or how the team's new hires are doing. The existing dashboard is HR-only.

This adds a **Team dashboard** for Managers: how much work the team holds, how fast and how punctually they finish it, and how their new hires are progressing.

**For:** a Manager with at least one direct report. **Success:** in one screen a manager can say who holds how much, what is overdue, how many requests the team resolved in the last 30 days and how long they took, and which of their new hires is behind.

**"Performance" here means work throughput from the requests and onboarding tasks the system records.** It is not a rating of a person. The system holds no hours, goals, reviews or attendance, so none of those can appear. There is **no composite score and no ranking**.

**Not a goal:** HR-wide or department-wide views (the HR dashboard exists), comparing teams, exports, alerts or emails, goals/KPIs/reviews, historical trend charts beyond the chosen period, a manager's own work (that is in their queue).

## Assumptions (correct me before approving)

1. **Who.** `MANAGER` role only. HR Admin gets `403` (they have the HR dashboard). A Manager with no direct reports sees an empty state, not an error. Employees get `403`.
2. **Team = direct reports** (`users.manager_id = me`), whatever their status (an On-notice person still holds work). The manager is not part of their own team's numbers.
3. **Attribution.** Work counts for the person it is **assigned to now**: a request's `assignee_id` and a task's `assignee_id`. A request reassigned before it was resolved counts for whoever held it when resolved. Unassigned requests and tasks belong to nobody and are not in any team number.
4. **Period.** `days` is 7, 30 or 90 (default 30): the last N calendar days **including today**, in Asia/Dhaka (the system's reference timezone). Period-based numbers use it; "open now", "overdue now", "blocked now" and new-hire progress are **current state** and ignore it.
5. **Requests** (assigned to team members):
   - *Open now*: status `ASSIGNED` or `IN_PROGRESS`.
   - *Resolved in period*: the request's `RESOLVED` event falls in the period (a later `CLOSED` does not matter).
   - *Time to resolve*: average of (resolved event time − request creation time) over those requests, shown in days and hours; "—" when none. It includes waiting time before assignment, because that is what the requester experienced.
6. **Onboarding tasks** (assigned to team members; the task's own assignee, so this works for department tasks the head assigned and for `MANAGER` tasks):
   - *Completed on time*: completed in the period, and the Dhaka date of completion is on or before the due date. *Completed late*: completed in the period, after the due date.
   - *Overdue now*: not completed, due before today. *Blocked now*: not completed, waiting on an unfinished dependency. *Open now*: not completed.
7. **The team's new hires** are direct reports with an `ACTIVE` checklist: name, country, % complete, overdue and blocked counts, and a link to the checklist (already visible to their manager). Not limited by the period.
8. **Per-person table**, one row per direct report, sorted by name (not by "best"): open requests, open tasks, overdue tasks, requests resolved in the period, tasks completed in the period (on time / late). A person with no work still appears, with zeros.
9. **Computed live, nothing stored.** Like the HR dashboard. **No schema change and no migration.** One new endpoint, `GET /dashboard/team?days=30`.
10. **Page and navigation.** A new page `/team` ("Team dashboard") with a nav item for Managers, using the existing design (KPI cards, ApexCharts bars, black/white/red palette). **A Manager lands on it after login** (`homeForRole("MANAGER")` becomes `/team`; today it is `/requests`). HR Admin still lands on `/dashboard`, Employees on `/requests`.
11. **Dependency.** Per-person task numbers rely on department tasks having an assignee, which exists only on `fix/onboarding`. That branch should be merged first; this feature then branches from `main`.

## Response shape (contract)

`GET /dashboard/team?days=7|30|90` → `200`:

```
{
  asOf, periodDays, periodStart,                       // ISO dates, Asia/Dhaka
  teamSize,
  requests: { open, resolvedInPeriod, avgHoursToResolve | null },
  tasks:    { open, overdue, blocked, completedOnTime, completedLate },
  newHires: [{ employee: { id, fullName, country }, instanceId, percentComplete, overdue, blocked }],
  people:   [{ id, fullName, jobTitle,
               openRequests, openTasks, overdueTasks,
               resolvedInPeriod, tasksCompletedOnTime, tasksCompletedLate }]
}
```

`days` other than 7/30/90 → `422`. Totals equal the sum of the per-person rows (`requests.open = Σ openRequests`, and so on); a test checks it.

## Commands

```
cd backend && npm test && npx tsc --noEmit
cd ../frontend && npx tsc --noEmit && npx vitest run
```

## Project structure (what changes)

```
backend/src/services/team-dashboard.ts        NEW  getTeamDashboard(manager, days, today)
backend/app/api/v1/dashboard/team/route.ts    NEW  GET, MANAGER only
backend/tests/team-dashboard.test.ts          NEW
frontend/app/(app)/team/page.tsx              NEW  the page
frontend/components/team/                     NEW  period picker, people table, new-hires list (small)
frontend/lib/{nav.ts,hooks/team.ts,types.ts}  nav item, query hook, response type
docs/architecture-v1.md                       §4.6 (new endpoint), §5 matrix, README
```

## Code style

Same as `dashboard.ts`: a service that takes the actor and returns a plain object, scoped through the actor's id rather than trusted input.

```ts
export async function getTeamDashboard(manager: AuthUser, days: 7 | 30 | 90, today = todayInDhaka()) {
  const team = await prisma.user.findMany({ where: { managerId: manager.id }, select: { id: true, fullName: true, jobTitle: true }, orderBy: { fullName: "asc" } });
  const ids = team.map((u) => u.id);
  // …every query below filters on `assigneeId: { in: ids }`; with no team, return zeros without querying.
}
```

## Testing strategy (test first, with mutation checks)

- **Scope:** a manager's numbers include only their own direct reports; another manager's reports, the manager's own work and unassigned items never appear; HR and Employee get `403`; a manager with no reports gets zeros and an empty list.
- **Requests:** open now counts `ASSIGNED` and `IN_PROGRESS` only; resolved-in-period respects the window edges (first and last day, one day outside); average time uses fixed event timestamps (hand-computed expected value); a reassigned request counts for the final assignee.
- **Tasks:** on-time versus late at the boundary (completed on the due date = on time; the day after = late); a completion before the period is excluded; overdue and blocked are current state and ignore `days`; the department task the head assigned counts for the assignee.
- **New hires:** only direct reports with an `ACTIVE` checklist; progress matches the checklist's own numbers.
- **Consistency:** totals equal the sum of the people rows; `days` validation (`7/30/90` only).
- **Mutation checks:** drop the `managerId` filter, flip the on-time comparison, drop the window start, count `SUBMITTED` as open; each must fail a test.
- **Frontend:** cards and table render from a response; the empty state; the period picker changes the `days` sent; a `403` shows the "only for managers" message; no per-person ranking or score is rendered.

## Boundaries

- **Always:** filter every query by the signed-in manager's own direct reports; compute from live tables; show names only for people in the manager's own team.
- **Ask first:** a schema change or stored metrics; showing HR or a department head's department (a different "team"); adding any score, ranking or rating; a new dependency; notifications.
- **Never:** show another manager's team; show a composite "performance score" or a ranked list of people; expose a request's description, comments or other content (counts and times only).

## Success criteria

1. A Manager opens `/team` and sees their direct reports' open work, resolved requests and time to resolve, on-time versus late tasks, new-hire progress, and the per-person table, for the chosen period.
2. Every number matches a hand calculation in the tests; totals equal the sum of the rows.
3. No data from another manager's team, HR, or an Employee ever appears (`403` / scoping tests).
4. The page follows the existing design and works at phone width; the period picker changes the numbers.
5. Backend and frontend tests and both type-checks pass; the architecture doc and README describe the endpoint and the page.

## Open questions

1. ~~Landing page~~ — **decided: yes**, Managers land on the Team dashboard.
2. **Average or median** time to resolve? Assumed average (simpler to explain); a median is better against one very slow request.
3. **HR Admin viewing a manager's team** (for example `?managerId=`)? Assumed **not in this change**.
4. ~~A manager who also heads a department~~ — **decided:** the dashboard knows nothing about departments or heads. A Manager is someone with direct reports. Existing request and onboarding assignment is unchanged (out of scope here).
