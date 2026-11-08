# Implementation Plan: HRIS Service Request & Onboarding Platform (v1)

Source spec: `docs/architecture-v1.md`. Task details and acceptance criteria: `tasks/todo.md`.
Tasks are tracked in `tasks/todo.md` (no external tracker).

## Overview

Greenfield build of two Next.js 16 apps (`frontend/`, `backend/`) over Supabase PostgreSQL, with two
modules (Service Requests, Onboarding) on a shared foundation (users, departments, roles, auth) and an
HR Admin dashboard. Nothing exists yet, so the plan builds bottom-up along the dependency graph and
slices vertically: each task delivers something testable through the API and, where relevant, the UI.

## Dependency graph

```
Backend scaffold ─ Prisma schema/migrations ─ Auth (withAuth, JWT)
        │                    │                        │
        │                    └── Base seed ───────────┤
        │                                             │
Frontend scaffold ── Login + app shell ───────────────┤
                                                      │
                  ┌───────────────────────────────────┤
                  │                                   │
   policy.ts + request state machine         Users/meta endpoints
                  │                                   │
        Requests API → Requests UI          Template API → Instance API
                  │                                   │
                  │                    Task transitions → Onboarding UI
                  └───────────────┬───────────────────┘
                                  │
                         Dashboard API → UI
                                  │
                         Deploy + README
```

## Architecture decisions (carried from the spec)

- Two separately deployed apps; frontend reaches backend only via the `/api/*` rewrite (same origin,
  httpOnly cookie, no CORS).
- All authorization in backend: `withAuth` (role) + `policy.ts` (row scope → 404) + `state-machine.ts`
  (409). Frontend only hides UI.
- Blocked / Overdue are calculated on read, never stored.
- Partial indexes, CHECK constraints and RLS-without-policies go in a hand-written SQL migration.
- Template tasks are copied at assignment.
- Plan-level choices: seed is built incrementally (base → requests → onboarding) so each phase is
  demoable; unit tests (Vitest) are written alongside `policy.ts` and the state machines, not at the end.

## Phases

### Phase 1 — Foundation (T1–T5)
Scaffolds, schema, auth, login, base seed. Exit: can log in as each seeded role and see an empty shell.

### Phase 2 — Service Requests (T6–T11)
Policy + state machine with tests, then API, then UI. Exit: full request lifecycle in the browser.

### Phase 3 — Onboarding (T12–T17)
Templates, assignment, task transitions with dependency/blocked logic, UI. Exit: HR assigns a
checklist, owners complete tasks, instance auto-completes.

### Phase 4 — Dashboard & Ship (T18–T20)
Aggregates and cross-module insights, deployment, README, DEBUG_LOG.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Prisma drops hand-written partial indexes on a later generated migration | High | Review every generated migration (T2); note the rule in README |
| Pooled connection (pgbouncer transaction mode) breaks Prisma migrate/transactions | High | Separate `DIRECT_URL` for migrate; verify against real Supabase in T2, not just local Postgres |
| Cookie not sent through rewrite on Vercel (secure/SameSite) | High | Verify the login round-trip deployed early (checkpoint after Phase 1 includes a preview deploy) |
| Scope leaks (row visible to wrong role) | High | `policy.ts` unit tests per role; detail endpoints always query with scope |
| Dependency cycles / cross-template dependencies in template save | Med | Validate in T12 with tests |
| Race on completing dependent tasks / last task | Med | Re-check blocked inside transaction (T14); test double-complete |
| Seed realism takes time (names, 100 users) | Low | Data tables in code, generated deterministically; budget in T5 |

## Decisions confirmed by the user

- Local development and tests use PostgreSQL in Docker (`docker-compose.yml` at repo root); Supabase is
  used only for the deployed environment.
- Package manager is npm for both apps.
- `GET /users` returns 403 for Employees (Manager: direct reports, HR Admin: all).

## Decisions made while building (flag if you disagree)

- **Initial password (T5):** the spec's `POST /users` has no password field. HR may supply one
  (`password`, min 10 chars); otherwise the server generates one and returns it once as
  `temporaryPassword`. No password-change flow exists in v1.
- **Created users** are always `EMPLOYEE` and `ON_PROBATION`; `role` cannot be set (unknown fields are
  rejected with 422). `managerId` must be a user with the Manager role.
- **"Active member" for assigning work** = status `ACTIVE` or `ON_PROBATION` (not `ON_NOTICE`).
- **`GET /users/assignable`:** HR Admin for any department; a Manager only for their own department
  (403 otherwise).
- **Seeding** refuses to wipe a non-local database unless `SEED_CONFIRM=yes` and `SEED_PASSWORD` is set.
  Demo logins: `hr.admin@`, `manager@`, `new.hire@`, `it.support@hris.test`.

- **Template editing (added on request, beyond the original spec):** `PUT /onboarding/templates/:id`
  replaces name, description and tasks in one transaction. It never touches checklists already
  assigned, because those are copies. Archiving/deleting templates is still out of scope.
- **New-hire status (added on request):** `POST /users` takes an optional `status` (`ACTIVE` or
  `ON_PROBATION`, default `ON_PROBATION`). Nothing changes it afterwards (editing users is out of scope).

- **No HR override on onboarding tasks (changed on request):** only a task's owner (member of the owning department,
  or the hire's manager for manager tasks) can start or complete it, same as service requests. HR Admin still sees
  every task and checklist. An HR Admin in the owning department (People & Culture) owns that department's tasks.
  Starting a task still records no actor; completing records `completedBy`.

- **Manager = department head (changed on request):** every Manager is treated as the head of their own department
  and can see and assign that department's service requests. There is no separate head role or extra permission:
  `headOfDepartmentId` is now derived from the user's role and department, not from `departments.head_id`. That
  column stays as the department's listed head (shown on the Departments page, default manager for new hires) and
  grants nothing. A Manager still works only in their own department; HR Admin keeps seeing everything.
  The seed has exactly one Manager per department (7 in all); the former extra managers are now Employees reporting to
  their department's Manager. Existing databases keep their old data until re-seeded.

## Frontend design rule (set by the user)

- **Palette is black, white and red only**, following nextventures.io. Red `#ed1c3e` (`--brand-red`)
  is the single accent: primary actions, active nav, focus rings, errors. Greys are tints of black
  (`#f3f3f3` surfaces, `#eae8e8` borders, `#6b6b6b` secondary text); no other hues, including in
  charts (Task 19) and status badges (use black/grey/red plus icons or labels, not new colours).
- **One font only: Poppins**, for everything including buttons, labels, table headers and badges (no
  mono or second typeface; vary weight/size/case instead). Sidebar and login hero are black with white text.
- **Corner radius is shadcn's default** (`--radius: 0.625rem` with the stock scale in `globals.css`). The 2px
  rounding tried earlier was removed at the user's request; there is no custom radius and no guard test for it.
  The earlier pill-shaped buttons are not coming back either (stock buttons use the default radius).
- **Sidebar selected item (user-specified):** navigation items sit flush against the sidebar's left edge with square
  left corners; only the selected item gets a red bar on that edge (`ITEM_CLASS` in `frontend/app/(app)/layout.tsx`,
  keyed on `data-active`). It keeps the same font weight as the other items (the stock `data-active:font-medium` is
  overridden). A 2px corner on the selected item was tried and removed at the user's request: there is no 2px radius.
- **Use the stock shadcn components, not hand-built or plain-HTML equivalents** (set by the user): Select (not
  `<select>`), Table, Card, Field (label + control + hint + error), Input Group, Textarea, Badge variants only,
  Progress, Sidebar. **Charts are the exception, by request: ApexCharts** (`apexcharts` + `react-apexcharts`),
  not the shadcn Chart/Recharts. Chart options live in `frontend/lib/charts.ts`; theme colours are resolved from CSS
  variables at runtime because Apex cannot use `var(--x)`; Apex's own accessibility/keyboard focus is switched off
  (the chart is hidden from assistive technology and a table beside it carries the data).
  Charts have no custom hover effect: one that greyed out the other bars was built, then removed at the user's request.
  Our look comes only from the theme tokens in `globals.css`. Small wrappers are fine
  when they just adapt a stock component: `SelectField` / `FilterSelect` (string values, "" = not chosen) and
  `PasswordInput` (Input Group + show/hide button).
- **After any `npx shadcn@latest add`**: the CLI re-adds the unknown `cn` npm package, rewrites imports to it, and
  can change pinned versions (it once moved `recharts`). Re-point imports to `@/lib/utils`, `npm uninstall cn`, and re-check
  `package.json`. Nothing in `components/ui` needs hand-editing for radius any more.
- **Notifications are toasts (set by the user): the shadcn Sonner `Toaster`** (`components/ui/sonner.tsx`, mounted once in
  `components/providers.tsx`, top right, always light). Every action's outcome is announced there: a mutation's success
  text is its `meta.success` (in `lib/hooks/*`) and a failure shows the server's message, handled in one place by the
  query client's `MutationCache`. Field-level errors stay beside their fields (a toast then just says to check them); the
  sign-in form shows no error in its card: every sign-in failure is a toast (wrong credentials get their own wording via
  `meta.failure`); page-load failures stay on the page with a Retry. The generated
  Sonner file was edited to drop `next-themes` (the app has one theme).
- **The sign-in form sits in a card** (heading, description, fields and button all inside it; errors are toasts). Password
  fields use `PasswordInput`, which has a show/hide button.
- All colours come from the tokens in `frontend/app/globals.css`. Do not hard-code colours in components.
- Known trade-off: white on `#ed1c3e` is about 4.3:1 contrast, just under WCAG AA (4.5:1) for small
  text. Keep red-filled controls at 14px medium or larger.

## Open questions

- None at this time.
