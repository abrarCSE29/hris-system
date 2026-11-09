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

> Model changed after T30: Groq `qwen/qwen3.8-27b` replaces Gemini (see spec v8). Task text below is the original record.

## AI chat draft (added after v1; spec: `docs/spec-ai-request-router.md`, intent: `docs/intent/ai-request-router.md`)

An employee types one message; a Gemini model (`gemini-3.5-flash`, through LangChain structured output) returns the form
fields; the employee edits them by hand and submits. The AI service is separate, stateless and database-free. The backend
records every call in a new `chat_drafts` table (who, from where, outcome, redacted error detail, request id). **That record is
for developers: it is read in the database, with no HR page and no API endpoint.** Tasks T23 to T28 in `tasks/todo.md`.

### Dependency graph

```
T23 AI service skeleton ─ T24 Drafter (LangChain, Gemini) ─┐
                                                             ├─ T26 Backend chat-draft + chat_drafts ─ T27 Chat head + draft card ─ T28 Docs, runbook, real-key check
T25 POST /requests: handlingDepartmentId ───────────────────┘
```

T23 to T24 and T25 are independent and can be built in either order. T27 needs T25 and T26.

### Slices

- **Phase 5 (AI service alone):** T23, T24. Exit: `curl` a message to `/v1/draft` and get a valid draft (fake model in tests, real
  Gemini by hand with the user's key); failures carry request id, cause and a redacted trace.
- **Phase 6 (through the backend):** T25, T26. Exit: `POST /requests/chat-draft` returns a validated draft and writes a
  `chat_drafts` row for every outcome, readable with SQL.
- **Phase 7 (UI and ship):** T27, T28. Exit: in the browser, a message becomes an editable card that submits; the README explains
  setup and debugging, with the SQL queries developers use to read the record.

### Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `gemini-3.5-flash` id or structured-output behaviour differs from the docs | High | Model id is a setting; the drafter validates every answer after the model (allowed codes, lengths) and retries once; a by-hand check with the real key at the end of T24 before any UI work |
| Error output leaks the employee's message (LangChain and Pydantic print rejected input) | High | Redaction in the AI service's logger and error bodies; a test that fails a call on purpose with a recognisable message and asserts it never appears in output or in `error_detail` |
| Python 3.14 with new dependencies | Med | Verified to install and import; version pinned with `.python-version` and `uv.lock`; Google SDK import warnings silenced in startup |
| Gemini free-tier rate limits | Med | `429` maps to `AI_RATE_LIMITED`, shown to the user as "AI unavailable" with a link to the normal form |
| AI call is slower than the platform's request limits | Med | 20 s timeout in the AI service and a matching client timeout in the backend; "Waking up the assistant…" after 3 s; set `maxDuration` on the route |
| Prompt injection in the message | Med | Message passed as data; output restricted to fixed codes and validated; the employee reviews every field; the AI cannot write anything |
| Client IP is the proxy's address behind the frontend rewrite | Low | Use `X-Forwarded-For` when present; document that locally it is `127.0.0.1` |
| Migration drops hand-written indexes or constraints | Low | Review the generated SQL as before; test that the new table and its indexes exist |

### Decisions confirmed by the user

- Gemini Flash (`gemini-3.5-flash`), Python 3.14, sending messages to Google is fine, free-tier limits are fine.
- Before submission; direct editing only; one message in, one draft out; floating chat head on every signed-in page.
- The AI service writes no files and has no database. The backend records who asked and from where (not what was said).
- The record is **for developers, not HR Admin**: no page, no endpoint, no nav item; developers query the database.
- Every AI issue is stored in the database (error code, short reason, redacted detail, request id), not only logged.
- Records are kept indefinitely in this build.

## Open questions

- None at this time.

## Lookup tables for role, country and status (spec: `docs/spec-lookup-tables.md`, idea: `docs/ideas/lookup-tables-user-fields.md`)

Move `users.role`, `users.country` and `users.status` from enums to their own tables with foreign keys. The API returns the three as
objects; filters take ids; behaviour compares on `code` / `shortcode`. No history, no edit screens.

```
T31 Schema + migration ─ T32 Backend reads and writes ─ T33 Seed and backend tests ─ T34 Frontend ─ T35 Docs + checkpoint
```

**Biggest risk:** the migration and about 24 backend and 26 frontend files that use the old values. Mitigation: the migration is tested
on a copy with users in every combination and stops on any empty row; each task ends with the suites green before the next starts.

## System logs for the backend (spec: `docs/spec-system-logs.md`)

Structured JSON logging to stdout: a wrapper that gives every request an id and logs it, a full redacted record for every 500, and
security events. No database table, no migration, no new dependency.

```
T37 Logger + redaction ─ T38 withRequest wrapper (request line, request id, 500 record) ─ T39 Security events ─ T40 Replace console.error, AI request id, frontend type ─ T41 Docs + checkpoint
```

**Biggest risk:** leaking personal data or secrets into logs (error text echoes values) and changing responses that tests rely on.
Mitigation: redaction is its own task with tests first; a "never logged" test is mutation-checked; every existing route test must pass unchanged.

## Manager dashboard: team performance (spec: `docs/spec-manager-dashboard.md`, approved v3)

A `/team` page for Managers and one endpoint, `GET /dashboard/team?days=7|30|90`: how much work the direct reports hold, what they
finished in the period (requests resolved, time to resolve, tasks on time or late), their new hires' progress, and a per-person table.
Computed live; no schema change, no migration, no new dependency. Managers land on it after login.

```
T42 Endpoint, scope, period, people rows ─ T43 Request measures ─ T44 Task measures ─ T45 New hires + consistency
                      │
                      └─ T46 Frontend: nav, landing, hook, page with cards and period picker ─ T47 Table, chart, new hires ─ T48 Docs + checkpoint
```

T43 and T44 add fields to the same service, so they run in order. T46 can start once T42 has fixed the response shape, but the cards only fill in after T43–T45.

**Biggest risks:**
- *Showing the wrong people's numbers.* Every query filters on the signed-in manager's direct reports. Tests put a second manager's team, the manager's own work and unassigned work in the data and assert none of it appears; mutation check: drop the filter.
- *Period and timezone edges.* "Last N days" and "on time" are Asia/Dhaka calendar days, inclusive. Tests use fixed timestamps on both sides of each edge and hand-computed expected values.
- *Counting the same work differently in totals and rows.* The totals are summed from the same per-person numbers, with a test that they agree.
