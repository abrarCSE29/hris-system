# Developer guide

Moved out of the README, which now only covers installing and running the system. The content is unchanged.
For the design, see [`ARCHITECTURE.md`](../ARCHITECTURE.md).

## Repository layout

```
frontend/   Next.js 16 + shadcn/ui + TanStack Query: the UI only. No database access, no secrets.
backend/    Next.js 16 API-only (Route Handlers) + Prisma + zod: auth, access control, all data, migrations, seed.
ai-service/ Python 3.14 + FastAPI + LangChain + Groq (Qwen): drafts a service request from a chat message. Private, stateless, no database.
docs/       Architecture document.
tasks/      Implementation plan and task list.
docker-compose.yml   Runs the whole system (database, backend, AI service, frontend).
```

The browser only talks to the frontend. The frontend forwards `/api/*` to the backend (a rewrite in
`frontend/next.config.ts`), so the session cookie is first-party and no CORS setup is needed.


## Run it for development (without Docker for the website)

Prerequisites: Node.js 20.19 or newer (developed and tested on Node 26), npm, Docker.

```bash
# 1. Database only (PostgreSQL 17 in Docker, host port 5433)
docker compose up -d --wait db

# 2. Backend  (http://localhost:4000)
cd backend
cp .env.example .env          # local defaults already point at the Docker database
npm install
npm run db:migrate            # apply migrations
npm run db:seed               # 100 people, 80 requests (last 90 days), 2 templates, 7 new hires
npm run dev

# 3. Frontend  (http://localhost:3000), in a second terminal
cd frontend
cp .env.example .env          # BACKEND_URL defaults to http://localhost:4000
npm install
npm run dev
```

Open <http://localhost:3000> and sign in.

### The AI chat assistant (optional)

An employee types one message in the chat button (bottom right) and the assistant fills in the request form for them to check and
edit. The panel is a chat thread: above the message box it shows their earlier requests made through the assistant, as bubbles with the
live status (it relies on `service_requests.channel`). It is a separate service, so the platform works without it (the button then points to the normal form).

Prerequisites: [uv](https://docs.astral.sh/uv/) and a Groq API key.

```bash
cd ai-service
cp .env.example .env     # then fill in GROQ_API_KEY and AI_SERVICE_TOKEN (see below). .env is git-ignored
uv sync                  # Python 3.14 is pinned in .python-version
uv run uvicorn app.main:app --reload --port 8000
```

| Where | Variable | Meaning |
|---|---|---|
| `ai-service/.env` | `GROQ_API_KEY` | Your Groq key. Only the AI service ever sees it. Never commit it. |
| `ai-service/.env` | `AI_SERVICE_TOKEN` | A long random string the backend must send. Make one with `openssl rand -base64 36`. |
| `backend/.env` | `AI_SERVICE_TOKEN` | The same string. |
| `backend/.env` | `AI_SERVICE_URL` | `http://localhost:8000` locally. |
| `ai-service/.env` | `GROQ_MODEL` | Defaults to `qwen/qwen3.8-27b`. |

Restart the backend after changing its `.env`. Check the service is up with `curl http://localhost:8000/health`.

- **Tests:** `cd ai-service && uv run pytest` (no key needed; the model is faked).
- **Quality check against the real model:** `uv run python -m eval.run` (needs the key; paces itself because the free tier allows only
  a few calls a minute; target at least 85% category accuracy).
- **Free-tier limits:** a free Groq key is rate limited. When it is, the assistant says it is unavailable and the form still works.

#### Debugging the assistant (for developers)

There is no screen for this: every chat draft is recorded in the database table `chat_drafts` (who asked, from which page, how it
went, and on failure why). The message text is never stored or logged. Connect to the database (locally:
`docker compose exec db psql -U hris -d hris`) and use:

```sql
-- failures in the last 24 hours, newest first
SELECT created_at, request_id, error_code, error, user_id, page
FROM chat_drafts WHERE outcome <> 'OK' AND created_at > now() - interval '24 hours' ORDER BY created_at DESC;

-- counts by cause (AI_UNREACHABLE, AI_TIMEOUT, AI_AUTH, AI_RATE_LIMITED, AI_MODEL_ERROR, AI_INVALID_OUTPUT, ...)
SELECT error_code, count(*) FROM chat_drafts WHERE outcome <> 'OK' GROUP BY error_code ORDER BY count(*) DESC;

-- one failure in full, with the AI service's redacted trace
SELECT * FROM chat_drafts WHERE request_id = '<request id>';

-- who has used it, and how often it needed its retry
SELECT u.full_name, count(*) AS drafts FROM chat_drafts d JOIN users u ON u.id = d.user_id GROUP BY 1 ORDER BY 2 DESC;
SELECT date_trunc('day', created_at) AS day, count(*) FILTER (WHERE attempts = 2) AS retried, count(*) AS total
FROM chat_drafts GROUP BY 1 ORDER BY 1 DESC;
```

To follow a failure into the AI service: take its `request_id` and search the AI service's output for it (the terminal running
`uvicorn` locally, the host's log viewer when deployed). Every log line there is one JSON object carrying that id, and a failure has a
traceback. The same redacted trace is kept in `error_detail`, so you can still read it after the host's logs have expired.
Error output is redacted: it holds the exception type, the code locations and the cause, never the employee's message.

| `error_code` | Usual cause and what to check |
|---|---|
| `AI_UNREACHABLE` | The AI service is not running, the URL is wrong, or `AI_SERVICE_URL`/`AI_SERVICE_TOKEN` is empty in `backend/.env`. Try `curl <url>/health`. |
| `AI_AUTH` | The two `AI_SERVICE_TOKEN` values differ. |
| `AI_RATE_LIMITED` | Groq's quota. Wait, or use a paid key. |
| `AI_MODEL_ERROR` | Groq returned an error, or `GROQ_API_KEY` is missing or rejected (see `error_detail`). |
| `AI_TIMEOUT` | The model took longer than 20 s. |
| `AI_INVALID_OUTPUT`, `AI_REJECTED_BY_BACKEND`, `AI_BAD_RESPONSE` | The model's answer was unusable twice, named a category or department we did not offer, or was in an unexpected shape. If these rise, check the prompt and the model name. |

Local-only switch: `DEBUG_LOG_PROMPTS=true` in `ai-service/.env` also logs the prompt and the model's raw reply (which include the
message). It warns at startup. Never use it in production.

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
- A user's role, country and status are rows in the lookup tables `roles`, `countries` and `user_statuses` (migration `*_user_lookup_tables`, hand-written; the seed fills them by code). The API returns them as objects with an id and filters by id; `GET /meta` lists the ids. They change by migration, not through the API.
- `*_constraints_indexes_rls` is **hand-written SQL**: CHECK constraints, partial indexes and row-level security,
  none of which Prisma's schema language can express.
- **Review every migration Prisma generates.** After changing the schema, check that nothing hand-written is dropped:

  ```bash
  cd backend && npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
  ```

  An empty result ("This is an empty migration") means the database and schema agree.
- Row-level security is enabled on every table with no policies. That blocks Supabase's public Data API; the
  backend connects as the table owner, which is unaffected.

## Logs

The backend writes one JSON line per request to stdout (warnings and errors to stderr), plus a full redacted record of any
unexpected error and lines for sign-ins, failed sign-ins, sign-outs, invalid sessions and 403s. While developing
(`npm run dev`) they print as short coloured lines, errors in red. Set `LOG_LEVEL` (`debug`, `info`, `warn`, `error`) to change
how much is written.

**Tracing a failure:** every response has an `x-request-id` header (and error bodies an `error.requestId`). Search the backend
output for that id to see the route, status, user and, for a 500, the error and its stack. For a chat-assistant draft the same
id is the `chat_drafts.request_id` and appears in the AI service's logs.

Passwords, cookies, tokens, request bodies, the attempted email on a failed sign-in and chat messages are never logged.
Nothing is stored in the database, so logs last as long as the host keeps them. Details: `docs/architecture-v1.md` §4.8.

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

## Demo accounts in detail

All seeded accounts share one password: `SEED_PASSWORD`, whose local-development default is defined in
[`backend/prisma/seed/data.ts`](../backend/prisma/seed/data.ts). Override it with the `SEED_PASSWORD` environment
variable when seeding.

| Email | Role | Good for seeing |
|---|---|---|
| `hr.admin@hris.test` | HR Admin | Dashboard, all requests, People, Onboarding overview, Templates, add a new hire |
| `manager@hris.test` | Manager (Engineering) | The **Team dashboard** (where a Manager lands): open and resolved requests, time to resolve, tasks on time vs late, workload per person and their new hires, for the last 7, 30 or 90 days. Also "My team", direct reports' requests and onboarding, their manager tasks in the Task queue. Also heads Engineering: sees and assigns Engineering's request queue and its onboarding tasks. |
| `new.hire@hris.test` | Employee, currently onboarding | "My onboarding" checklist with blocked and overdue tasks; their own requests |
| `it.support@hris.test` | Employee in IT Operations | Requests assigned to them (start/resolve); the IT onboarding tasks the IT head assigned to them, in the Task queue |
| `it.manager@hris.test` | Manager (IT Operations) | The busiest **Team dashboard** (requests, tasks done on time and late, a new hire); IT's whole request queue and all of IT's onboarding tasks (the "Needs an owner" filter), with Assign / Reassign on both |

Every Manager is the head of their own department; there is no separate head role. Managers are listed on the People page (API: `GET /users?roleId=<id of the Manager role>`, ids from `GET /meta`).
