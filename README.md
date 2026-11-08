# HRIS: Service Requests & Employee Onboarding

Internal platform for a ~100-person company in Bangladesh, Malaysia, Sri Lanka and Cyprus. It combines
**Service Requests** and **Employee Onboarding** on one shared set of people, departments and roles, with an
HR Admin dashboard.

- Design and rationale: [`docs/architecture-v1.md`](docs/architecture-v1.md)
- Plan and task list: [`tasks/plan.md`](tasks/plan.md), [`tasks/todo.md`](tasks/todo.md)
- Problems met while building, and how they were solved: [`DEBUG_LOG.md`](DEBUG_LOG.md)

## Repository layout

```
frontend/   Next.js 16 + shadcn/ui + TanStack Query: the UI only. No database access, no secrets.
backend/    Next.js 16 API-only (Route Handlers) + Prisma + zod: auth, access control, all data, migrations, seed.
docs/       Architecture document.
tasks/      Implementation plan and task list.
docker-compose.yml   Local PostgreSQL (port 5433).
```

The browser only talks to the frontend. The frontend forwards `/api/*` to the backend (a rewrite in
`frontend/next.config.ts`), so the session cookie is first-party and no CORS setup is needed.

## Run it locally

Prerequisites: Node.js 20.19 or newer (developed and tested on Node 26), npm, Docker.

```bash
# 1. Database (PostgreSQL 17 in Docker, host port 5433)
docker compose up -d --wait

# 2. Backend  (http://localhost:4000)
cd backend
cp .env.example .env          # local defaults already point at the Docker database
npm install
npm run db:migrate            # apply migrations
npm run db:seed               # 100 people, 35 requests, 2 templates, 7 new hires
npm run dev

# 3. Frontend  (http://localhost:3000), in a second terminal
cd frontend
cp .env.example .env          # BACKEND_URL defaults to http://localhost:4000
npm install
npm run dev
```

Open <http://localhost:3000> and sign in.

### Demo logins

All seeded accounts share one password: `SEED_PASSWORD`, whose local-development default is defined in
[`backend/prisma/seed/data.ts`](backend/prisma/seed/data.ts). Override it with the `SEED_PASSWORD` environment
variable when seeding.

| Email | Role | Good for seeing |
|---|---|---|
| `hr.admin@hris.test` | HR Admin | Dashboard, all requests, People, Onboarding overview, Templates, add a new hire |
| `manager@hris.test` | Manager (Engineering) | "My team", direct reports' requests and onboarding, their manager tasks in the Task queue. Also heads Engineering: sees and assigns Engineering's request queue. |
| `new.hire@hris.test` | Employee, currently onboarding | "My onboarding" checklist with blocked and overdue tasks; their own requests |
| `it.support@hris.test` | Employee in IT Operations | Requests assigned to them (start/resolve); IT onboarding tasks in the Task queue |
| `farid.tan@hris.test` | Manager (IT Operations) | IT's whole request queue, with Assign / Reassign (also while the work is in progress) |

Every Manager is the head of their own department; there is no separate head role. Managers are listed on the People page (API: `GET /users?role=MANAGER`).

## Everyday commands

| Where | Command | What it does |
|---|---|---|
| `backend/` | `npm test` | Vitest. Needs the Docker database running (it creates and migrates a separate `hris_test` database) |
| `backend/` | `npm run lint` | Type-check (`tsc --noEmit`) |
| `backend/` | `npm run db:seed` | Wipes and re-creates all data (refuses a non-local database; see below) |
| `backend/` | `npm run db:up` / `db:down` | Start / stop the Docker database |
| `frontend/` | `npm test`, `npm run lint`, `npm run build` | Unit tests, type-check, production build |

> **Do not run `npm run build` in a folder while `npm run dev` is running there.** They share `.next/` and the dev
> server breaks until restarted (see `DEBUG_LOG.md`).

## Database and migrations

- Schema: `backend/prisma/schema.prisma`. Migrations: `backend/prisma/migrations/`.
- `*_constraints_indexes_rls` is **hand-written SQL**: CHECK constraints, partial indexes and row-level security,
  none of which Prisma's schema language can express.
- **Review every migration Prisma generates.** After changing the schema, check that nothing hand-written is dropped:

  ```bash
  cd backend && npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
  ```

  An empty result ("This is an empty migration") means the database and schema agree.
- Row-level security is enabled on every table with no policies. That blocks Supabase's public Data API; the
  backend connects as the table owner, which is unaffected.

## Deploying (Vercel + Supabase)

> **Not yet done or verified.** Everything below is prepared and the code builds without any environment
> variables set, but I have not been able to deploy it. Treat the first deployment as a checklist item, and see
> "Things to check on the first deploy".

Three pieces: one Supabase project, and two Vercel projects (one per folder).

1. **Supabase.** Create a project. Note two connection strings from *Project Settings → Database*:
   the **pooler, transaction mode** (port 6543) for the app, and the **direct connection** (port 5432) for migrations.
2. **Backend, Vercel project 1.** Root directory `backend/`. Environment variables:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase pooler (transaction mode) connection string |
   | `DIRECT_URL` | Supabase direct connection string |
   | `JWT_SECRET` | A random string of at least 32 characters, e.g. `openssl rand -base64 48` |

   The build runs `prisma generate` automatically.
3. **Frontend, Vercel project 2.** Root directory `frontend/`. Environment variable `BACKEND_URL` = the backend
   project's URL (for example `https://hris-backend.vercel.app`). The build fails with a clear message if it is missing.
4. **Create the schema and data, from your machine:**

   ```bash
   cd backend
   DIRECT_URL="<supabase direct url>" DATABASE_URL="<supabase direct url>" npm run db:migrate
   DIRECT_URL="<supabase direct url>" DATABASE_URL="<supabase direct url>" \
     SEED_CONFIRM=yes SEED_PASSWORD="<choose a strong password>" npm run db:seed
   ```

   The seed script **deletes all data** and refuses to touch a non-local database unless `SEED_CONFIRM=yes` and
   `SEED_PASSWORD` are set. Do not seed a database that holds real data.
5. **Check it:** open the frontend URL, sign in as `hr.admin@hris.test`, then walk through a request and an onboarding task.

### Things to check on the first deploy

- **Cookie through the rewrite.** After signing in, the `hris_session` cookie should be set on the *frontend's*
  domain (`HttpOnly`, `Secure`, `SameSite=Lax`) and refreshing should keep you signed in.
- **Database TLS.** If the backend logs `self-signed certificate in certificate chain`, node-postgres is rejecting the
  pooler's certificate. Decide how to handle that deliberately (supply the CA certificate, or relax verification);
  it is not relaxed in the code today.
- **Pooled connection.** The app uses one connection per server instance (`max: 1`) and unnamed statements, which
  should suit Supabase's transaction pooler. Migrations use the direct connection.
- **Row-level security** with the real database role: the app should still read and write normally.

## What is deliberately not in v1

Reopening or withdrawing requests; archiving or deleting templates; editing users after creation (including their
status); password change or reset; deactivating users; notifications; rate limiting; an OpenAPI spec; end-to-end
browser tests; business-day deadlines and public holidays. The AI service is designed as a separate service and is
not part of this repository. Full list: `docs/architecture-v1.md` §9.

Added beyond the original spec, on request: editing onboarding templates (it only affects checklists assigned
afterwards) and choosing a new hire's starting status.

## Known gaps

- **The UI has not been looked at in a real browser.** Automated tests cover the API, the access rules and the
  front-end logic, and every page has been fetched through the running stack, but visual layout, the mobile
  breakpoints and the charts have not been inspected by a person or by browser automation.
- **Not deployed**, as above.
