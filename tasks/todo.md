# Task List — HRIS v1

Sizes: XS 1 file · S 1–2 · M 3–5. Spec section refs point to `docs/architecture-v1.md`.
Every task also clears the project Definition of Done (builds, lints, tests green).

---

## Phase 1 — Foundation

### Task 1: Backend scaffold with health endpoint and shared helpers
**Description:** Create `backend/` (Next.js 16 API-only, TS, Prisma, zod, jose, bcrypt, Vitest) with
`GET /api/v1/health`, error helper (`{error:{code,message}}`), zod validation helper, pagination helper.
**Acceptance criteria:**
- [x] `GET /api/v1/health` → `{status:"ok"}` without auth
- [x] Error helper maps 401/403/404/409/422 to the spec format (§4.1)
- [x] `.env.example` lists `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, with local Docker defaults
- [x] `docker-compose.yml` at repo root starts Postgres; `npm run db:up` / `db:down` scripts wrap it
**Verification:**
- [x] `npm test` and `npm run build` pass in `backend/`
- [x] Manual: `docker compose up -d` then `curl localhost:PORT/api/v1/health`
**Dependencies:** None
**Files:** `docker-compose.yml`, `backend/package.json`, `backend/app/api/v1/health/route.ts`, `backend/src/lib/errors.ts`, `backend/src/lib/validation.ts`, `backend/.env.example`
**Scope:** M

### Task 2: Prisma schema and migrations (incl. constraints, partial indexes, RLS)
**Description:** Full schema for all tables/enums (§3.2–3.3), generated initial migration, plus a
hand-written SQL migration for CHECK constraints, partial indexes (§3.4), `SR-` sequence, and
`ENABLE ROW LEVEL SECURITY` on every table with no policies (§3.5).
**Acceptance criteria:**
- [x] `prisma migrate deploy` succeeds on a fresh DB
- [x] CHECKs reject: self-manager, assigned-status without assignee, DEPARTMENT task without department
- [x] Partial unique index rejects a second ACTIVE onboarding for one employee
- [x] RLS enabled on all tables; backend connection still reads/writes
**Verification:**
- [x] Constraint test script/Vitest hitting a real DB passes
- [x] Re-running `prisma migrate dev --create-only` produces no migration dropping the partial indexes
**Dependencies:** T1
**Files:** `backend/prisma/schema.prisma`, `backend/prisma/migrations/*_init/`, `backend/prisma/migrations/*_constraints_indexes_rls/migration.sql`, `backend/src/lib/prisma.ts`
**Scope:** M

### Task 3: Authentication — login, logout, me, `withAuth`
**Description:** JWT (jose, 8h) in httpOnly/Secure/SameSite=Lax cookie `hris_session`; `withAuth(handler,{roles})`
loads user from DB each request; `/auth/me` returns `{user,isNewHire,headOfDepartmentId}`.
**Acceptance criteria:**
- [x] Bad credentials → 401; email matched case-insensitively
- [x] Cookie flags correct; logout → 204 and clears cookie
- [x] Role change in DB applies on next request; disallowed role → 403
- [x] `isNewHire` true only with an ACTIVE onboarding instance
**Verification:**
- [x] Vitest for login/me/withAuth (valid, expired, tampered token, wrong role)
- [x] Manual: curl login with cookie jar, then `/auth/me`
**Dependencies:** T2 (plus a throwaway user via test fixture; real seed in T5)
**Files:** `backend/src/lib/auth.ts`, `backend/src/lib/with-auth.ts`, `backend/app/api/v1/auth/{login,logout,me}/route.ts`, `backend/tests/auth.test.ts`
**Scope:** M

### Task 4: Frontend scaffold, login page, session redirect, app shell
**Description:** `frontend/` Next.js 16 + Tailwind + shadcn/ui + TanStack Query; `next.config.ts` rewrite
`/api/:path*` → `BACKEND_URL`; `proxy.ts` redirects to `/login` without cookie; typed API client;
login page; authenticated shell with role-based nav (display only).
**Acceptance criteria:**
- [x] Unauthenticated visit to any app page → `/login`
- [~] Valid login lands on dashboard/requests (by role); invalid shows error
- [x] Nav items differ by role; logout works
**Verification:**
- [x] `npm run build` passes
- [~] Manual in browser against local backend: login/logout round-trip, cookie set via rewrite
**Dependencies:** T3
**Files:** `frontend/next.config.ts`, `frontend/proxy.ts`, `frontend/lib/api.ts`, `frontend/app/(auth)/login/page.tsx`, `frontend/app/(app)/layout.tsx`
**Scope:** M

### Task 5: Base seed — departments, 100 users, categories, `/meta`, `/users`
**Description:** Seed script part 1 (§7): 7 departments with heads, 100 users across 4 countries/3 roles/statuses,
5 request categories → handling departments. Add `GET /meta`, `GET /users`, `GET /users/assignable`,
`POST /users` (without templateId yet). Simple People page in frontend.
**Acceptance criteria:**
- [x] Seed is idempotent (clears and recreates) and country split is 40/25/20/15
- [x] 3 HR Admins, ~12 Managers; each department has a head; documented logins per role
- [x] `/users`: Manager sees only direct reports, HR all, Employee 403; filters work
- [x] `POST /users` HR-only, validates, hashes password, lower-cases email
**Verification:**
- [x] Vitest for `/users` scoping; `npm run db:seed` twice without error
- [~] Manual: People page shows filtered list for HR
**Dependencies:** T3, T4
**Files:** `backend/prisma/seed.ts`, `backend/app/api/v1/{meta,users,users/assignable}/route.ts`, `frontend/app/(app)/people/page.tsx`
**Scope:** M (split seed data tables into a separate file if over 5 files)

### Checkpoint: Foundation
- [ ] All tests pass; both apps build
- [ ] Log in as HR Admin, Manager, Employee locally; People page respects scope
- [ ] Both apps deployed to Vercel previews and login works end-to-end against Supabase (cookie via rewrite)
- [ ] Review with human before proceeding

---

## Phase 2 — Service Requests

### Task 6: `policy.ts` request scope and request state machine (with unit tests)
**Description:** `scopeRequests(user)` per §5.3 and the transition table/`allowedActions` per §6.1 in `state-machine.ts`.
Pure functions, no routes.
**Acceptance criteria:**
- [x] Scope: Employee own+assigned; Manager + direct reports + head's department; HR all
- [x] Every transition tested for allowed and disallowed actor and invalid from-state
- [x] Assign requires assignee to be an active member of the handling department
**Verification:**
- [x] `npm test` passes with the matrix covered
**Dependencies:** T2
**Files:** `backend/src/services/policy.ts`, `backend/src/services/state-machine.ts`, `backend/tests/policy.test.ts`, `backend/tests/state-machine.test.ts`
**Scope:** S

### Task 7: Requests API — create, list, detail, comment
**Description:** `POST/GET /requests`, `GET /requests/:id` (request + events + comments + `allowedActions`),
`POST /requests/:id/comments`. Reference `SR-1001…` from sequence; handling dept copied from category; initial
event row in same transaction; out-of-scope → 404.
**Acceptance criteria:**
- [x] Create returns 201, status SUBMITTED, correct handling department
- [x] List paginated, filtered by status/category/priority/country, always scoped
- [x] Out-of-scope detail and comment → 404
- [x] Zod errors → 422
**Verification:**
- [x] Vitest integration tests per role
**Dependencies:** T5, T6
**Files:** `backend/app/api/v1/requests/route.ts`, `backend/app/api/v1/requests/[id]/route.ts`, `backend/app/api/v1/requests/[id]/comments/route.ts`, `backend/src/services/requests.ts`
**Scope:** M

### Task 8: Request transitions endpoint
**Description:** `POST /requests/:id/transitions` for assign/start/resolve/close using the state machine; status
change + event row in one transaction; 409 on invalid.
**Acceptance criteria:**
- [x] Full lifecycle Submitted→Assigned→In Progress→Resolved→Closed works for the right actors
- [x] Reassign allowed from Assigned and from In Progress (back to Assigned, to a different person); wrong actor/state → 409 (or 404 if out of scope)
- [x] DB CHECK (assignee required unless SUBMITTED) never triggered by the API
**Verification:**
- [x] Vitest integration test of the lifecycle and each rejection
**Dependencies:** T7
**Files:** `backend/app/api/v1/requests/[id]/transitions/route.ts`, `backend/src/services/requests.ts`, `backend/tests/requests-transitions.test.ts`
**Scope:** S

### Task 9: Requests UI — list and create
**Description:** Requests list (filters, pagination, status/priority badges) and "New request" form using `/meta`.
**Acceptance criteria:**
- [x] List respects filters and pagination; empty state shown
- [x] Create form validates client-side and shows server 422 messages; redirects to detail
**Verification:**
- [~] Build passes; manual run as Employee and HR
**Dependencies:** T7
**Files:** `frontend/app/(app)/requests/page.tsx`, `frontend/app/(app)/requests/new/page.tsx`, `frontend/lib/hooks/requests.ts`, `frontend/components/requests/*`
**Scope:** M

### Task 10: Request detail UI — timeline, actions, comments
**Description:** Detail page with timeline from events, comments thread, action buttons driven solely by
`allowedActions`, assignee picker via `/users/assignable`.
**Acceptance criteria:**
- [x] Only allowed buttons render; actions refresh the page state
- [x] 409 shown as readable message; out-of-scope shows not-found
**Verification:**
- [~] Manual full lifecycle across three logins in the browser
**Dependencies:** T8, T9
**Files:** `frontend/app/(app)/requests/[id]/page.tsx`, `frontend/components/requests/{timeline,comments,actions}.tsx`
**Scope:** M

### Task 11: Seed service requests
**Description:** Add 35 requests (all categories/statuses/priorities), consistent history rows, ≥6 with 2–4
comments, several from new-hire-designated users, assigned to department members.
**Acceptance criteria:**
- [x] Counts and distributions match §7; every request's events end at its current status
- [x] IT Ops employee login has assigned requests
**Verification:**
- [x] Seed runs clean; quick SQL count checks; spot-check in UI
**Dependencies:** T8
**Files:** `backend/prisma/seed.ts` (or `seed/requests.ts`)
**Scope:** S

### Checkpoint: Service Requests
- [x] All tests green (backend 313, frontend 11); lifecycle verified through the API for all roles
- [~] Request lifecycle works in the browser for 3 roles (not yet seen in a browser)
- [x] Scope leak spot-check: an unrelated Employee gets 404 for another user's request (API-level)
- [ ] Review with human

---

## Phase 3 — Onboarding

### Task 12: Onboarding templates API
**Description:** `GET/POST /onboarding/templates`, `GET /onboarding/templates/:id`. Tasks submitted with
client `key` / `dependsOnKey`; validate same-template dependencies, no cycles, owner rules; deadline label →
offset mapping.
**Acceptance criteria:**
- [x] Cycle or unknown `dependsOnKey` → 422
- [x] DEPARTMENT tasks require department; MANAGER tasks must not have one
- [x] HR-only (others 403)
**Verification:**
- [x] Vitest incl. cycle (A→B→A) and self-dependency
**Dependencies:** T5
**Files:** `backend/app/api/v1/onboarding/templates/**/route.ts`, `backend/src/services/onboarding.ts`, `backend/tests/templates.test.ts`
**Scope:** M

### Task 13: Assign checklist (instances) and calculated task status
**Description:** `POST /onboarding/instances` copies template tasks (due = start + offset, MANAGER tasks
assigned to hire's manager, dependencies remapped); `POST /users` accepts `templateId`;
`GET /onboarding/instances`, `/instances/:id`, `/me` with calculated Blocked/Overdue and progress summary (Asia/Dhaka).
**Acceptance criteria:**
- [x] Second ACTIVE instance for same employee → 409
- [x] Blocked and overdue computed correctly, including chains A→B→C
- [x] Manager sees only direct reports' instances; hire sees own via `/me`; others 404/403
- [x] `POST /users` with templateId is atomic (user + checklist or neither)
**Verification:**
- [x] Vitest with fixed "today" for overdue; scope tests
**Dependencies:** T12
**Files:** `backend/app/api/v1/onboarding/{instances,instances/[id],me}/route.ts`, `backend/app/api/v1/users/route.ts`, `backend/src/services/onboarding.ts`, `backend/src/services/policy.ts`
**Scope:** M

### Task 14: Task queue and task transitions
**Description:** `GET /onboarding/tasks` (owned tasks) and `POST /onboarding/tasks/:id/transitions`
(start/complete), blocked check repeated inside the transaction, auto-complete instance on last task,
onboarding task state machine + tests.
**Acceptance criteria:**
- [x] Owner = member of owning department or assigned manager; no HR override (changed on request); non-owners who can see the task get 409, strangers 404
- [x] Start/complete while blocked → 409; completing unblocks dependents
- [x] Last task completed → instance COMPLETED; double-complete → 409
**Verification:**
- [x] Vitest for transitions matrix and concurrent complete
**Dependencies:** T13
**Files:** `backend/app/api/v1/onboarding/tasks/route.ts`, `backend/app/api/v1/onboarding/tasks/[id]/transitions/route.ts`, `backend/src/services/state-machine.ts`, `backend/tests/onboarding-tasks.test.ts`
**Scope:** M

### Task 15: Onboarding UI — my checklist and task queue
**Description:** "My onboarding" page (progress, tasks with Blocked/Overdue indicators and "waiting for X"),
task queue page with start/complete actions.
**Acceptance criteria:**
- [x] Blocked tasks show waiting-for and no actions
- [x] Complete/start update UI; overdue flagged separately from status
**Verification:**
- [~] Manual as new hire, IT Ops employee, Manager
**Dependencies:** T14
**Files:** `frontend/app/(app)/onboarding/me/page.tsx`, `frontend/app/(app)/onboarding/tasks/page.tsx`, `frontend/components/onboarding/*`
**Scope:** M

### Task 16: Onboarding UI — HR templates, assign, progress overview
**Description:** Template list/create form (task rows with dependencies), assign checklist to employee, progress
table per hire (filter by country), detail view; new-hire creation form with template option.
**Acceptance criteria:**
- [x] Cycle error from API displayed on the form
- [x] Progress table matches API counts; Manager sees only their reports
**Verification:**
- [~] Manual: create template → create hire with it → see checklist
**Dependencies:** T13, T15
**Files:** `frontend/app/(app)/onboarding/{templates,templates/new,instances,instances/[id]}/page.tsx`, `frontend/components/onboarding/*`
**Scope:** M

### Task 17: Seed templates and new hires
**Description:** Two templates (10 and 12 tasks, with dependency chains) and 7 new hires (10–55 days ago, all
countries) with mixed task states: ≥3 overdue, ≥2 blocked, some completed. Mark them ON_PROBATION.
**Acceptance criteria:**
- [x] Counts as in §7; seeded states consistent (no completed task depending on incomplete one)
- [x] Documented logins: Manager with a new-hire report, a new-hire employee, IT Ops employee with IT tasks
**Verification:**
- [x] SQL checks plus UI spot check
**Dependencies:** T14
**Files:** `backend/prisma/seed.ts` (or `seed/onboarding.ts`)
**Scope:** S

### Checkpoint: Onboarding
- [x] All tests green (backend 554, frontend 18); end-to-end verified over HTTP: HR creates hire + checklist, owner completes tasks, dependants unblock, instance completes (tested)
- [x] Blocked/overdue visible in seeded data (3+ overdue, 2+ blocked, asserted by tests)
- [ ] Review with human

---

## Phase 4 — Dashboard & Ship

### Task 18: Dashboard summary API
**Description:** `GET /dashboard/summary` (HR only): headcount by country, requests by status/category,
onboarding totals, `newHiresWaiting` (per handling department), `completionRateByCountry`.
**Acceptance criteria:**
- [x] Values verified against seed via independent SQL
- [x] Non-HR → 403
**Verification:**
- [x] Vitest against seeded/fixture data
**Dependencies:** T11, T17
**Files:** `backend/app/api/v1/dashboard/summary/route.ts`, `backend/src/services/dashboard.ts`, `backend/tests/dashboard.test.ts`
**Scope:** S

### Task 19: Dashboard UI
**Description:** shadcn charts and KPI cards for the summary, including the two cross-module insights.
**Acceptance criteria:**
- [x] All summary fields rendered; empty/loading/error states
- [x] Page hidden from non-HR in nav and blocked server-side
**Verification:**
- [~] Manual as HR; build passes
**Dependencies:** T18
**Files:** `frontend/app/(app)/dashboard/page.tsx`, `frontend/components/dashboard/*`
**Scope:** M

### Task 20: Deployment, README, DEBUG_LOG
**Description:** Production deploy of both apps to Vercel against Supabase (migrate via `DIRECT_URL`, seed),
README (setup, env, logins, architecture link, migration-review rule), DEBUG_LOG.md. Move
`docs/architecture-v1.md` to match the repo layout in §10 if desired.
**Acceptance criteria:**
- [x] Fresh clone + README instructions runs locally (verified in a clean copy: install, migrate, seed, build, production start, sign-in)
- [ ] Deployed app: login, request lifecycle, onboarding, dashboard all work (NOT DONE: needs your Vercel and Supabase accounts)
- [x] No secrets committed; `.env.example` complete in both apps (`.env` files are git-ignored)
**Verification:**
- [ ] Full manual walkthrough on the deployed URLs (NOT DONE: depends on the deploy)
**Dependencies:** T19
**Files:** `README.md`, `DEBUG_LOG.md`, `backend/.env.example`, `frontend/.env.example`
**Scope:** S

### Checkpoint: Complete
- [~] Acceptance criteria met except deployment; tests pass (backend 578, frontend 21)
- [~] §9 "Not in v1" items absent from code, except template editing and starting status, added on request
- [ ] Ready for review

## Phase 5 — Department breakdown (added on request, spec §4.7)

### Task 21: Department breakdown API
**Description:** `GET /departments/breakdown` (HR only): per department the head, headcount and the split by country,
status and role.
**Acceptance criteria:**
- [x] Counts match independent SQL; `total` equals the dashboard headcount
- [x] Empty departments appear with zeros; every list carries all enum values in a fixed order
- [x] Non-HR → 403, no cookie → 401
**Verification:**
- [x] Vitest against the seed and a fixture with an empty department
**Dependencies:** T18
**Files:** `backend/app/api/v1/departments/breakdown/route.ts`, `backend/src/services/departments.ts`, `backend/tests/departments.test.ts`
**Scope:** S

### Task 22: Departments page
**Description:** HR-only `/departments` page: one row per department (head, headcount, share, country/status/role split),
linking to People filtered by that department. Nav item for HR Admin only.
**Acceptance criteria:**
- [x] Loading, error, 403 states; numbers readable without colour
- [x] Selecting a department opens `/people?departmentId=…` with the filter applied
- [x] Nav item shown to HR Admin only
**Verification:**
- [~] Component tests and API over HTTP as HR (200) and manager (403) done; not seen in a browser, `next build` not run (dev server is running)
**Dependencies:** T21
**Files:** `frontend/app/(app)/departments/page.tsx`, `frontend/lib/hooks/departments.ts`, `frontend/lib/nav.ts`, `frontend/app/(app)/people/page.tsx`
**Scope:** M


## Phase 5 — AI service (spec: docs/spec-ai-request-router.md)

> Model changed after T30: Groq `qwen/qwen3.8-27b` replaces Gemini (spec v8). Task text below is the original record; the open real-key walkthroughs now need a `GROQ_API_KEY`.

### Task 23: AI service skeleton, security and logging
**Description:** Create `ai-service/` (Python 3.14, uv, FastAPI): config from env, `GET /health` (public, no Gemini call),
the `X-Service-Token` check (constant time), a request id taken from `X-Request-Id`, JSON logging with the request id on every
line, and the redaction helper for tracebacks. Docs disabled in production. `.env.example`, `.gitignore` (ignores `.env`).
**Acceptance criteria:**
- [x] `uv sync` and `uv run uvicorn app.main:app --port 8000` work on Python 3.14; startup silences the Google SDK warnings
- [x] `/health` returns `{ status, model }` without calling Gemini
- [x] A call without or with a wrong token gets `401`; the right token passes
- [x] Every log line is one JSON object carrying the request id; the service writes no file and opens no database connection
- [x] A traceback is logged and returned in redacted form: exception type, frames and cause, no input values
**Verification:**
- [x] `uv run pytest`: token, request id, log shape, redaction (a failing call with a recognisable message never prints it), no files written
**Dependencies:** None
**Files:** `ai-service/app/{main,config,security,logging}.py`, `ai-service/tests/*`, `pyproject.toml`, `.python-version`, `.env.example`, `.gitignore`
**Scope:** M

### Task 24: Drafter: LangChain + Gemini structured output
**Description:** `POST /v1/draft`: build the prompt from the received categories and departments (priority guide, rules, message
as data), call `gemini-3.5-flash` through `langchain-google-genai` `with_structured_output(Draft, method="json_schema")`,
validate the answer against the codes received, retry once, and return the draft with `confidence`, `lowConfidence`, `model`,
`latencyMs`, `attempts`. Failures return the error body (code, message, type, redacted detail, request id) with the right status
(`502`, `504`, `429` mapped). Small labelled evaluation set and `eval/run.py`.
**Acceptance criteria:**
- [x] Valid output, an unknown code then a valid retry (`attempts: 2`), invalid twice (`502`), timeout (`504`), rate limit, all behave as the spec says
- [x] `lowConfidence` is true below `CONFIDENCE_THRESHOLD`; a non-request message returns category Other with `lowConfidence`
- [x] The prompt holds the message only as data; only the message, country and department name reach the model
- [x] `DEBUG_LOG_PROMPTS` is off by default and warns when on
**Verification:**
- [x] `uv run pytest` with a fake chat model; no test calls Gemini
- [x] **By hand with the user's key:** `uv run python -m eval.run` reached 15 of 15 on category; the laptop example is IT Equipment / Urgent / IT Operations (checked through HTTP as well)
**Dependencies:** T23
**Files:** `ai-service/app/{drafter,prompts,schemas}.py`, `ai-service/eval/*`, `ai-service/tests/*`
**Scope:** M

### Checkpoint: AI service alone
- [x] Tests pass; a message over HTTP returns a draft; failures carry request id and redacted trace
- [ ] Review with the user (needs their Gemini key in `ai-service/.env`)

## Phase 6 — Backend (the chat record is for developers: no page, no endpoint)

### Task 25: Create a request in a chosen department
**Description:** `POST /requests` accepts an optional `handlingDepartmentId`; when present it must be an existing department and
replaces the category's department as the handling department; absent behaves as today.
**Acceptance criteria:**
- [x] With and without the field; an unknown department gives `422`; the chosen department's Manager sees the request
**Verification:**
- [x] Vitest against the test DB; existing request tests still pass
**Dependencies:** None
**Files:** `backend/src/services/requests.ts`, `backend/tests/requests.test.ts`, `docs/architecture-v1.md`
**Scope:** S

### Task 26: chat-draft endpoint and the chat record
**Description:** Prisma model and hand-reviewed migration for `chat_drafts` (columns per the spec, RLS with no policies, indexes);
`ai-client` (token, 20 s timeout, error mapping to codes); `POST /requests/chat-draft` builds the call, validates the answer,
maps codes to ids, and **writes one `chat_drafts` row for every outcome** (who from the session, page, IP, user agent, request id,
outcome, `error_code`, `error`, redacted `error_detail`, `attempts`, model, latency, chosen values, message length, never the text).
A failure to write the row never fails the draft.
**Note:** the categories table has no `description` column, and the AI needs one. Keep the descriptions in a backend constant (same text as `ai-service/eval/categories.py`) rather than adding a column.
**Acceptance criteria:**
- [x] Success returns ids and values; `401`, `422` (empty, too long, extra field, a `userId` in the body); `503` for unreachable, timeout, auth, rate limit, bad shape, invalid output, rejected codes
- [x] A row exists for each of those outcomes with the right `error_code`; `error_detail` never contains the message
- [x] No request is created by `chat-draft`
**Verification:**
- [x] Vitest with the AI client mocked; migration reviewed; table and indexes asserted
**Dependencies:** T24 (contract), T25
**Files:** `backend/prisma/schema.prisma`, `backend/prisma/migrations/*`, `backend/src/lib/ai-client.ts`, `backend/src/services/intake.ts`, `backend/app/api/v1/requests/chat-draft/route.ts`, `backend/tests/chat-draft.test.ts`
**Scope:** M

### Checkpoint: backend end to end
- [ ] `curl` as a signed-in user returns a draft and a row appears; with the AI service stopped, a failed row appears with its reason (checked with SQL)
- [ ] All tests pass

## Phase 7 — Frontend and ship

### Task 27: Chat head and draft card
**Description:** Floating chat head in the signed-in layout opening a sheet: message box (1,000 characters, counter, "Waking up…"
after 3 s), the draft card with every field editable (title, description, category, priority, department; category change sets
the department), "AI suggested" badges, low-confidence note, reasoning line, Submit (existing mutation, passes
`handlingDepartmentId`), Start over, AI-down fallback with a link to `/requests/new`. Sends the current page path. Draft kept in memory when the sheet closes.
**Acceptance criteria:**
- [x] Every field editable; the submitted request has exactly the values shown; toasts for success and failure; not shown on the login page
**Verification:**
- [x] Component tests; `npx tsc --noEmit`
- [ ] Manual in the browser with the real service (not done: no browser available here, and the Gemini quota is used up)
**Dependencies:** T25, T26
**Files:** `frontend/components/chat/*`, `frontend/lib/hooks/chat.ts`, `frontend/app/(app)/layout.tsx`, `frontend/tests/chat-*.test.tsx`
**Scope:** M

### Task 28: Docs, runbook and the real-key check
**Description:** README: set up and run the AI service (uv, `.env`, token), environment variables for the backend, and a short
"debugging the AI service" runbook (the SQL queries developers use to read `chat_drafts`, taking a request id from a failed row, searching the service's logs for it, the stored detail).
Update `docs/architecture-v2.md` or add a note that v2's chat slice is built as in the spec. Final by-hand run with the user's key.
**Acceptance criteria:**
- [x] The README explains setup of all three apps, the variables, and the debugging runbook (SQL queries, error codes); no secret committed; `ai-service/.env.example` complete
**Verification:**
- [ ] (NOT DONE: needs Gemini quota and a restart of the dev servers) Walkthrough: laptop message to a submitted request; with the AI service stopped, a failed row appears in `chat_drafts` (read with the runbook's SQL)
**Dependencies:** T27
**Files:** `README.md`, `ai-service/.env.example`, `backend/.env.example`, `DEBUG_LOG.md`
**Scope:** S

### Task 29: Record the channel and list my chat requests (backend)
**Description:** New column `service_requests.channel` (enum `FORM` default, `CHAT`) with a migration; `POST /requests` accepts an
optional `channel`; `GET /requests` gains `mine=true` (only my own) and `channel` filters; the summary includes `channel`.
**Acceptance criteria:**
- [x] `channel` stored (`CHAT`, default `FORM`); an invalid value is `422`; existing rows read as `FORM`
- [x] `mine=true` returns only the caller's own requests, also for a Manager and an HR Admin; `channel=CHAT` only chat ones; scope rules unchanged
**Verification:**
- [x] Vitest against the test DB; migration reviewed; `prisma migrate diff` shows no drift
**Dependencies:** T25, T26
**Files:** `backend/prisma/schema.prisma`, a new migration, `backend/src/services/requests.ts`, `backend/tests/requests.test.ts`, `docs/architecture-v1.md`
**Scope:** S

### Task 30: Earlier requests in the chat thread (frontend)
**Description:** Rework the panel as a chat thread: greeting bubble, then the person's earlier chat requests as bubble pairs (their
title on the right, the assistant's card on the left with reference link, department, live status, priority, time), then the
current step; the message box stays at the bottom while composing. The list loads when the panel opens and is refreshed after Submit.
The chat head sends `channel: "CHAT"` when submitting.
**Acceptance criteria:**
- [x] Pairs in order (oldest first, newest at the bottom), live status badge, link to the request; loading, error and empty states; the greeting stays first
- [x] A just-submitted request appears (sent as a chat request, and the list refreshes after Submit) in the thread; form requests do not; the draft behaviour from T27 is unchanged
**Verification:**
- [x] Component tests; `npx tsc --noEmit`
- [ ] Manual in the browser (not possible here)
**Dependencies:** T29, T27
**Files:** `frontend/components/chat/{bubble,past-requests,chat-head}.tsx`, `frontend/lib/hooks/chat.ts`, `frontend/lib/hooks/requests.ts`, `frontend/lib/types.ts`, `frontend/tests/chat-*.test.tsx`
**Scope:** M

### Checkpoint: AI chat draft complete
- [ ] All acceptance criteria met; all test suites pass; no automated test calls Gemini
- [ ] Ready for review

## Phase 6: Lookup tables (spec: docs/spec-lookup-tables.md, approved v2). T31 done

### Task 31: Tables, columns and the migration
**Description:** Add `roles`, `countries`, `user_statuses`; add `role_id`, `country_id`, `status_id` to `users`; backfill; drop the enum columns and types. Hand-written migration (see spec).
**Acceptance criteria:**
- [x] The three tables with seed rows, unique codes, a two-capital-letter shortcode check, row-level security on
- [x] Every user backfilled; the migration stops if any is empty; foreign keys `ON DELETE RESTRICT`; indexes replaced
- [x] Old columns and enums gone; Prisma client regenerated
**Verification:**
- [x] Migration test on a database with users in every old role, country and status; the drift check is empty
**Done:** `backend/prisma/migrations/20261110090000_user_lookup_tables/`, `backend/tests/migration-lookup-tables.test.ts` (6 tests, mutation-checked). Applied to the test database only; the dev database is **not** migrated yet, so the user's running dev servers stay on the old shape until T32 and T33 are done. The rest of the backend does not compile until T32/T33 (188 type errors, the worklist).
**Dependencies:** none
**Files:** `backend/prisma/schema.prisma`, a new migration, `backend/tests/schema.test.ts`
**Scope:** M

### Task 32: Backend reads and writes
**Description:** Serializer, `loadAuthUser`, `/meta`, users list and create, department breakdown, dashboard (including the raw SQL), policy, onboarding, requests, intake and state machine use the new relations; compare on `code`.
**Acceptance criteria:**
- [ ] Every response that returns a user has the three objects; `/meta` returns `roles`, `countries`, `userStatuses`
- [ ] Filters `roleId`, `countryId`, `statusId` take ids; unknown or malformed gives 422 with the path; create user takes `countryId` and optional `statusId`
- [ ] Permissions are unchanged; the token is unchanged (the role is still read from the database)
**Verification:**
- [ ] Vitest; no query per user (relations loaded together)
**Dependencies:** T31
**Files:** `backend/src/lib/*`, `backend/src/services/*`, `backend/app/api/v1/meta/route.ts`
**Scope:** L

### Task 33: Seed and backend tests
**Description:** The seed creates the lookup rows first and refers to them by code; test helpers and assertions use the new shape.
**Acceptance criteria:**
- [ ] The seed still produces 7 Managers, 3 HR Admins and 90 Employees; all backend tests pass
- [ ] No test or seed hard-codes a generated id
**Verification:**
- [ ] `npm test` in `backend/`
**Dependencies:** T32
**Files:** `backend/prisma/seed/*`, `backend/tests/*`
**Scope:** L

### Task 34: Frontend
**Description:** Types, hooks, pages and components show `name`, compare on `code`, and send ids in filters and forms.
**Acceptance criteria:**
- [ ] The people, department, dashboard and onboarding screens look and behave as before
- [ ] Filters and the new-user form send ids taken from `/meta`
**Verification:**
- [ ] `npx tsc --noEmit`; `npx vitest run`; manual in the browser
**Dependencies:** T32
**Files:** `frontend/lib/types.ts`, `frontend/lib/hooks/*`, `frontend/app/**`, `frontend/components/**`, `frontend/tests/*`
**Scope:** L

### Task 35: Docs
**Description:** Update `docs/architecture-v1.md` (data model and API) and the README.
**Acceptance criteria:**
- [ ] Docs describe the three tables, the object shape, the id filters
**Dependencies:** T33, T34
**Scope:** S

### Checkpoint: Lookup tables complete
- [ ] All acceptance criteria met; both test suites and the type-check pass; drift check empty
- [ ] Ready for review
