# ARCHITECTURE


---

# Part 1: Architectural decisions (author's notes)

## Feature based decisions.

### Module A : Service Request

1. An person in the company can create a service request. A service request involves title, description, urgency, Department that the request is to be routed. HR Admin can see all request and status and deparment managers can see reqeusts that are routed to their department. An HR admin and manager can assign a team member in the department. Members can be reassigned. After completion of task. That can be closed by the person who opened it. users may add notes and comments in the request flow.

2. Currently, A resolved request stays open untill the person who opened it closes. In next phase , it may be decided after how long the request automatically gets closed if not interacted with it or HR Admin / manager can close it  y their role scope. No notifications currently is not served. in future, state updates may be routed to user notification box and completion of request may also be informed through in app and email. Sometimes a request may need to be re routed through different department. My assumption is that a manager for the department assigns to HR Admin and HR Admin forwards it. Attachment Facility should be used if any conviennce fee is required by employee. these are proposed but not built.

3. Service request can be filtered by their status.
### Module B Onboarding.

1. Onboarding system includes a new employee, a task checklist for that employee. Which department the employee is going to be assigned to. Therefore there are two systems that has to be implemented. One where the system allows the creation of a new employee. another where the system permits creating a templated checklist for onboarding. The system allows the creation of employee without checklist because a template may not exist yet for that postition and later, An HR admin can create the checklist and assign it to that employee. this enables onboarding a new user without mandadory checklist - for loose coupling so that creating of new employee does not get hung up on template. Also, an employee may start working on a specific day but on boarding may get late due to unforseen reasons, therefore, their employment date is preserved.

2. An HR Admin can create a template checklist for different role. Each task in the checklist has the option to assign a department for that task. When a checklist is assigned, the respective department manager can see that in their task queue and can assign anyone in the department for that task, Here HR Admin can also assign and reassign for a particular task in the checklist.

3. After successful onboarding completion, the employee gets in the department that he was assigned to.

4. When creating employee, an employee role maybe same (set of permissions, setup etc.) but they may hold different job title, therefore, HR admin can assign role and Job title seprately. In the future this may become role with Job title, for example, role :employee , title : Software Engineer, Role : employee , Title HRIS System Developer. password creation is not kept default for easy user creation, in future, new onboarding employees will get a link to create / update password to activate their account only after HR Admin has created.

5. Tasklist is designed to be asynchronous process, one task may or may not depend on other task so that non dependent work can be done smoothly.

Roles and access scopes are maintained with jwt tokens.

Please note Task Queue tab shows on boarding related tasks that are assigned to the department for completion. Manager can assign task from there.



## AI Feature : (Intelligent Request Router)

For the intelligent request router, a user types their request description in plain language. that request is routed to AI Service. Using LLM with department, System context and user request, the AI Service returns a strucutured output to the backend web app. A user can review and edit if needed and submit it. here , I am usign the need for human in the loop for ensuring consistency. Currently using GROQ API. For unrelated or ambioguous requests, the response tells the user explicitly to verify the response.

## Dashboard :

Separate Dashboard for HR Admin and Manager. HR Admin can see overall progress of service requests and status of on boarding, while a Manager can only see their own department progress. Admin dashboard is verified. Manager dashboard needs verification of dashboard data.

## Auth and RBAC :
Roles are currently checked with wrapper. Each wrapper gets the employee ID from jwt token to fetch permission. The role is not embedded in the jwt because if permission is revoked, then it would reflect instantly. Authentication is now based on email and password.

Extra features i added to see departments, and employees associated with them to easily debug the workflow and user that can be assigned for a task.

## System architecture Design Decision:

1. I decided on a 3 Service system - Web application Frontend, web application backend, both on nextjs and ai-service on FastAPI. The reason for this is that then the system remains loosely coupled and its easier to update and maintain features and also can be easily collaborated with others. The frontend connects with backend. The backend then connects with the AI Service. As Future AI feature maybe added, ai feature based development on python is much omore easier for future development maintainability. currently the web app is communicates with ai service with api but as system grows and long running task may arrive, we may have to move to asychronous processing strucuture.

## Database design

Database contains various tables. The thing i gave emphasis while building is maintainablity. For example, using role directly for a user may arise issue in updateing role info in the fututre beacause many records will need to be updated. on the other hand using a foreign key for roles and dedicated role table ensures easy and consistency. similar goes for country, employee status.

## API Design

API are designed with versioning. currently its on v1 version. Currently wrappers are used for authorization. in next iteration, it should be moved to middleware.

---

# Part 2: The system as it is today

## 2.1 Overview

An internal HR platform for a company of about 100 people in Bangladesh, Malaysia, Sri Lanka and Cyprus. It has two modules on one shared base of users, departments, roles, countries and statuses: **service requests** and **employee onboarding**. An AI chat assistant helps fill in a service request. There are three roles: **Employee**, **Manager** and **HR Admin**.

```
Browser ──► frontend (Next.js 16)  ──/api/* rewrite──►  backend (Next.js 16, API only)  ──►  PostgreSQL
                                                              │
                                                              └─ HTTP ─►  ai-service (FastAPI) ─►  Groq API
```

| Service | Folder | What it is | Responsibility |
|---|---|---|---|
| Frontend | `frontend/` | Next.js 16 (App Router), TypeScript, shadcn/ui on Base UI, Tailwind, TanStack Query, ApexCharts | The UI. No database access. The browser only talks to this service; `next.config.ts` rewrites `/api/*` to the backend, so the session cookie is first-party and no CORS setup is needed. |
| Backend | `backend/` | Next.js 16 with Route Handlers only, TypeScript, Prisma 7, zod, `jose`, `bcryptjs` | Authentication, access control, all reads and writes, state rules, dashboards, schema, migrations, seed, logging. |
| AI service | `ai-service/` | Python, FastAPI, LangChain, Groq (default model `qwen/qwen3.8-27b`) | Turns one chat message into a draft service request. Private and stateless; it has no database. |
| Database | | PostgreSQL 17 (Docker Compose on port 5433 for development) | The only store of data. |

No code is shared between the services; the contract is the HTTP API. The backend is the only caller of the AI service, and it validates what comes back.

**Not verified:** deployment. The project is designed for Vercel (two projects) and a hosted PostgreSQL, but this repository has only been run locally.

## 2.2 Access control (RBAC)

Four layers, all in the backend. The frontend only hides what a role cannot use.

1. **Identity.** Login with email and password (`bcryptjs`) sets an HTTP-only `hris_session` cookie holding a signed JWT (HS256, 8 hours). The token carries **only the user id**. On every request `getAuthUser` (`backend/src/lib/auth.ts`) loads the user, role and status from the database, so a role change applies at once. This is the decision in Part 1.
2. **Route gate.** Every route handler is wrapped in `withAuth(handler, { roles })` (`backend/src/lib/with-auth.ts`), built on `withRequest`. It answers `401` with no valid session and `403` for a role not in the list (401 is checked first), and writes `auth.session_invalid` and `auth.forbidden` events to the log.
3. **Row scoping** (`backend/src/services/policy.ts`). Functions such as `scopeRequests`, `scopeUsers`, `scopeInstances` and `scopeOwnedTasks` return Prisma `where` clauses that queries must use. A row outside the caller's scope answers `404`.
4. **Action rules** (`backend/src/services/state-machine.ts`). Pure functions decide whether this actor may do this action on a record in its current state (`409` or `403` otherwise). The same functions produce `allowedActions` / `allowedTaskActions`, which the UI uses to show buttons.

**Middleware.** The backend has no Next.js middleware; the wrappers above do that job. The only middleware-style file is `frontend/proxy.ts`, which redirects to `/login` when the session cookie is missing. It does not validate the session. Moving authorisation into middleware is a stated next step (Part 1). Nothing forces a new route to use `withAuth`.

**Department head.** There is no fourth role. A Manager heads their own department (`headOfDepartmentId`, one Manager per department), and the scoping and action rules read that.

| Capability | Employee | Manager | HR Admin |
|---|---|---|---|
| Submit a request | yes | yes | yes |
| See requests | own and assigned to them | also direct reports' and the queue of the department they head | all |
| Assign or reassign a request | no | requests routed to their department | any |
| Start or resolve a request | if assignee | if assignee | if assignee |
| Close a request | if requester | if requester | yes |
| See onboarding checklists | own | own, direct reports', and any with a task owned by their department | all |
| Assign an onboarding task | no | tasks owned by their department | any department task |
| Start or complete a task | if assigned | if assigned, or it is their department's, or their own `MANAGER` task | only tasks assigned to them |
| Templates, create people, assign checklists | no | no | yes |
| HR dashboard (`/dashboard`) | no | no | yes |
| Team dashboard (`/team`) | no | own direct reports | no |
| People list | no | direct reports | everyone |

## 2.3 Module A: service requests

- Anyone can submit a request with a title, description, priority (Low, Medium, High, Urgent) and a category. The category decides the handling department (IT Equipment and Software Access go to IT Operations, HR Query and Other to People & Culture, Facilities to Operations). The request gets a reference such as `SR-1001`.
- Status flow: **Submitted → Assigned → In Progress → Resolved → Closed**.
  - The Manager of the handling department, or an HR Admin, assigns it to an active member of that department. It can be **reassigned** (to someone else); reassigning an In Progress request sends it back to Assigned.
  - Only the assignee starts and resolves it.
  - The requester closes it, and HR Admin can close it too. A resolved request stays resolved until someone closes it. There is no automatic closing.
- Every change writes a history row (`request_events`). Users with access to a request can add comments.
- The request list filters by status, and also by priority and channel.
- Requests carry a channel: `FORM` (the normal form) or `CHAT` (raised through the AI assistant).

**Not built:** forwarding a request to another department (the Part 1 idea of the manager passing it to HR Admin), attachments, notifications (in-app or email), automatic closing, and reopen, withdraw or reject.

## 2.4 Module B: onboarding

- **People and checklists are separate.** HR Admin creates a person (`POST /users`) with name, email, country, role, department, manager, job title, joining date and status. Role and job title are separate fields. A checklist is optional: it can be created with the person (`templateId`), or assigned later by HR Admin. The joining date is stored on the person, so it does not depend on when the checklist is made.
- **Passwords.** HR Admin can set the initial password; otherwise one is generated and shown once. There is no activation link or self-service reset.
- **Templates.** HR Admin creates and edits templates of tasks. Each task has an owner type (a department, or the new hire's manager), a due-day offset and at most one dependency (chains are allowed). Assigning a template copies its tasks into a checklist, so later edits to a template do not change checklists already assigned.
- **Task queue.** A task owned by a department is first assigned to nobody. The department head sees every task the department owns and either does it or assigns it to one active member of the department; HR Admin can assign any department's tasks. The assignee then sees it in their queue; other members do not.
- **Dependencies.** A task whose dependency is not completed is **blocked** (calculated, not stored). Tasks that do not depend on each other can be done in any order.
- **Overdue** is calculated against today's date in Asia/Dhaka.
- **Completion.** When the last task is completed, the checklist becomes `COMPLETED`. **This does not move the person.** Part 1 says the employee "gets in the department" after onboarding; in the code the department is chosen when the person is created and does not change when the checklist finishes. The person's status is also not changed by completing a checklist.

**Not built:** cancelling an onboarding, deleting or archiving templates, reopening a completed task, editing a person after creation, deactivation.

## 2.5 AI request assistant

Flow: the user types a message in the chat head, the frontend calls `POST /requests/chat-draft` on the backend, the backend calls the AI service, and the AI service asks the model for structured output (LangChain structured output, schema in `ai-service/app/schemas.py`).

- **What the model receives:** the message, the requester's country and department name, and the list of categories and departments. It returns a title, description, category, priority, confidence and reasoning.
- **Human in the loop.** The backend checks the draft (codes must be from the lists it sent) and returns it. Nothing is saved. The user reviews and edits a request card and submits it through the normal request endpoint, with channel `CHAT`.
- **Unclear or unrelated messages.** The prompt tells the model to use the `OTHER` category and a low confidence. The backend returns `lowConfidence`, and the request card shows a notice asking the user to check it.
- **Failure.** If the AI service is down, times out or returns something invalid, the backend answers `503 AI_UNAVAILABLE` and the frontend shows a toast ("The AI service is currently unavailable. You can still fill in the form yourself."). The rest of the app works; the form never depends on the AI.
- **Records.** The backend stores one row per attempt in `chat_drafts` (outcome, timing, redacted details) for developers. The message text is not logged. Tracing to third parties is forced off in the AI service.
- **Calls are synchronous** (request and response over HTTP), as in Part 1. No queue or background processing exists.

**Not verified:** the assistant has been tested with the model mocked, and the AI service over HTTP against a model earlier in development. It has not been confirmed against Groq with the current default model and key. `docs/architecture-v2.md` also describes assignee recommendation and database views for the AI service; **neither is built**.

## 2.6 Dashboards

Both are computed from live tables on each request; nothing is stored. Both are covered by automated tests that compare numbers against hand calculations.

- **HR dashboard** (`GET /dashboard/summary`, HR Admin only): headcount by country, requests by status and category, new hires in progress, overdue and blocked onboarding tasks, and cross-module figures (new hires with open requests, requests waiting per department).
- **Team dashboard** (`GET /dashboard/team?days=7|30|90`, Manager only): for the Manager's **direct reports**: requests open and resolved with average time to resolve, onboarding tasks on time vs late, overdue and blocked, the team's new hires, and a per-person table. It shows no ranking or score. **It is based on direct reports, not on the department**, which differs from the Part 1 wording ("their own department"). Spec: `docs/spec-manager-dashboard.md`.
- A Manager lands on `/team` after login; an HR Admin on `/dashboard`; an Employee on `/requests`.
- Whether the dashboards look right in a browser is not confirmed in this repository's records; the numbers are verified by tests only.

## 2.7 Extra pages

- **Departments** (`/departments`, HR Admin; `GET /departments/breakdown`): departments with their people and heads. This is the helper added to see who can be assigned a task.
- **People** (`/people`): the list of people (Managers see direct reports) and the new-hire form.

## 2.8 Database

PostgreSQL, accessed through Prisma 7 (schema in `backend/prisma/schema.prisma`, migrations in `backend/prisma/migrations/`).

- **Lookup tables.** `roles`, `countries` and `user_statuses` are separate tables referenced by foreign key, as in Part 1, so a name changes in one row. Users also point to a department and to a manager (a user).
- **Other tables:** `departments`, `users`, `request_categories`, `service_requests`, `request_events`, `request_comments`, `onboarding_templates`, `template_tasks`, `onboarding_instances`, `onboarding_tasks`, `chat_drafts`.
- **Constraints.** Foreign keys, enums, CHECK constraints and partial unique indexes are written in a hand-checked migration (for example, one active checklist per person). A test asserts the partial indexes exist.
- **Transactions.** State changes and their history rows are written in one transaction. The connection pool is limited to one connection, so code inside a transaction must use the transaction client (a past deadlock).
- **Seed** (`npm run db:seed` in `backend/`) wipes and recreates demo data: 100 people, 7 departments, 80 requests over 90 days, and onboardings. Never run it against data you want to keep.

## 2.9 API

- All endpoints are under `/api/v1`. Errors use one envelope with a code and message (`401`, `403`, `404`, `409`, `422`, `503`).
- Every request gets an id (`x-request-id`) and a JSON log line (method, route pattern, status, duration, user id). Security events are logged separately. Bodies, cookies and message text are never logged.
- Endpoint groups: `auth` (login, logout, me), `users`, `meta` (lookup lists), `requests` (list, create, detail, transitions, comments, chat-draft), `onboarding` (templates, instances, tasks, task transitions and assign, `me`), `dashboard` (summary, team), `departments/breakdown`, `health`.
- Authorisation uses wrappers today; Part 1 plans to move to middleware.

## 2.10 Tests

- Backend (Vitest, real PostgreSQL test database): about 950 tests covering the policy and state-machine rules, every endpoint, the seed and the dashboards.
- Frontend (Vitest, Testing Library): about 190 tests of pages, forms, the chat assistant, charts and the error toasts.
- AI service (pytest): the drafter, redaction and basics.
- Run with `npm test` in `backend/` and `frontend/` (`npx tsc --noEmit` too), and `uv run pytest` in `ai-service/`.

## 2.11 Known limits

- No notifications, attachments, request forwarding or automatic closing (Part 1 lists these as proposed).
- No editing or deactivating a person after creation; no session revocation (a token stays valid until it expires, although role changes apply at once).
- No rate limiting, and no audit trail of who changed HR data beyond request history and security log lines.
- Authorisation depends on each route using `withAuth`.
