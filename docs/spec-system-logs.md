# Spec: system logs for the backend

Status: **v1, draft for your review.** Source: the conversation on `feature/system-logs` (how logs are handled today, the stdout-JSON and database-table options).
Related: `docs/architecture-v1.md`, `ai-service/app/logging.py` (the pattern to follow), `backend/src/lib/{with-auth,errors}.ts`.

## Objective

Today the backend logs almost nothing. Two `console.error` calls exist (`src/lib/errors.ts:47`, `src/services/intake.ts:56`). They print
plain text with no time, level, request id or user. When a request fails there is nothing to tell **when** it happened, **how** (route, input
shape, status) or **why** (error and stack). Logins, 401s and 403s leave no trace at all.

This change adds structured logging to the backend: one JSON line per request on stdout, a full record for every unexpected error, and a
`system_logs` table that keeps errors and security events for a fixed time so they can be searched with SQL.

**For:** developers now, and whoever runs the system. **Success:** given a `requestId` from a failed call, a developer finds what happened,
for which user, on which route, and the error with its stack, without reproducing it.

**Not a goal:** a screen or API for reading logs (they are for developers, like `chat_drafts`), an audit trail of HR changes (who changed a
person's role; a separate table with its own retention), metrics, alerting, tracing across services beyond the shared request id,
frontend error reporting.

## Assumptions (correct me before approving)

1. **Two outputs.** Every log goes to **stdout as one JSON object per line** (the primary log, same idea as the AI service). A subset is
   **also** written to the table `system_logs` (item 6). stdout always happens, even if the database write fails.
2. **One wrapper for every route.** A new `withRequest(handler)` in `backend/src/lib/` does, for every request: take or create the request id,
   time the call, run the handler, convert thrown errors to the error envelope, and log. `withAuth` is built on it. The public routes
   (`/auth/login`, `/auth/logout`, `/health`) use it too; today login catches errors itself and `/health` has no wrapper.
3. **Request id.** Taken from an incoming `x-request-id` header if it is a valid UUID, otherwise generated. It is returned on every response as
   the `x-request-id` header and, for errors, inside the envelope as `error.requestId`. The AI call already sends a request id to the AI
   service; it becomes this same id, so one id finds the backend line, the `chat_drafts` row and the AI service's lines.
4. **Per-request line (`http.request`), stdout only.**
   `ts, level, event, requestId, method, route, status, ms, userId`. `route` is the route **pattern** (`/api/v1/requests/:id`), never the raw URL,
   so ids and query strings (which can carry search text) stay out. `userId` is present when the session was valid. Level: `info` for 2xx and 3xx,
   `warn` for 4xx, `error` for 5xx. `GET /health` is not logged (it is polled).
5. **Error line (`http.error`), for unexpected errors (the 500s).** Adds `errorName`, `errorCode` (for example the Prisma code `P2003`),
   `message` and `stack`, all redacted (item 8). The client still gets only `Internal server error` plus the `requestId`. Expected errors
   (`ApiError`: 401, 403, 404, 409, 422) are **not** given a stack; they appear only in the per-request line.
6. **The table `system_logs`** holds: every `http.error`, and these security events: failed login (`auth.login_failed`), login success
   (`auth.login`), logout, 401 on a request that had a cookie (`auth.session_invalid`), and 403 (`auth.forbidden`). Successful ordinary requests are **not** stored.

   | Column | Type | Notes |
   |---|---|---|
   | `id` | uuid | primary key |
   | `created_at` | timestamptz | default now |
   | `level` | enum `LogLevel` (`WARN`, `ERROR`) | |
   | `event` | text | `http.error`, `auth.login_failed`, … |
   | `request_id` | uuid | not unique (one request can log twice) |
   | `method`, `route`, `status`, `duration_ms` | text, text, int, int | route is the pattern |
   | `user_id` | uuid null | **no foreign key**, so a log row never blocks or follows a user change |
   | `ip`, `user_agent` | text null | same truncation as `chat_drafts` (64 and 300 characters) |
   | `error_name`, `error_code`, `message`, `stack` | text null | redacted; `stack` capped at 8,000 characters |

   Indexes: `(created_at DESC)`, `(request_id)`, `(user_id, created_at DESC)`. Row-level security on with no policies, like every other table.
   A failed login stores **neither the attempted email nor a hash of it**: only `ip`, `user_agent`, time and `event`
   (an email typed into a login box is often a password or a mistyped address, and is not needed to see an attack).
7. **Writing the row never hurts the request.** The insert is awaited (or run with Next's `after()` where available) inside a try/catch; a
   failure is written to stdout as `log.write_failed` with the error name only, and the response is unchanged. It adds one insert to error and
   security paths only, never to ordinary successful requests.
8. **What is never logged, to stdout or the table:** request or response bodies, headers, cookies, the `Authorization` value, passwords,
   password hashes, tokens, the JWT, the AI message text, API keys. Error text can echo values (Prisma and `fetch` errors do), so `message` and
   `stack` pass through a redaction step: remove anything that looks like a bearer token, a JWT, a `key=` or `token=` query value, an email
   address, or a bcrypt hash, and cut at a length limit. `console.log` of an object is replaced by the logger, so nothing prints un-redacted.
9. **Logger module.** `backend/src/lib/logger.ts` exposes `log(level, event, fields)` and `redact(text)`. Fields named like reserved JSON keys
   cannot overwrite `ts`, `level` or `event` (the AI service has a test for the same crash). Level comes from `LOG_LEVEL` (default `info`).
   The two existing `console.error` calls move to it.
10. **Retention.** Rows older than **90 days** are deleted by a scheduled job (a Vercel cron route `POST /api/internal/purge-logs`, protected by
    a secret header; locally a script `npm run logs:purge`). 90 days is my default; say a different number.
11. **Access.** Developers read the table with SQL. There is no page and no API endpoint, so HR Admin cannot see it (the same rule as
    `chat_drafts`). The table is created by a migration; the app role may insert and delete (for purge) only.
12. **No new dependency.** The logger is about 60 lines over `console.log(JSON.stringify(...))`. A library (`pino`) is not needed at this size.
13. **Sampling is off.** At ~100 users every request line is kept in stdout. Revisit only if volume becomes a cost.
14. **Tests never touch a real outside service.** Tests capture stdout and read the table in `hris_test`.

## Commands

```
cd backend
npm run db:up
npm run db:migrate && npx prisma generate
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script   # drift check, must be empty
npm test
npm run logs:purge          # new: delete rows older than the retention
cd ../frontend && npx tsc --noEmit && npx vitest run      # frontend only needs the new error.requestId type
```

## Project structure (what changes)

```
backend/src/lib/logger.ts                 NEW  log(), redact(), request-id helpers
backend/src/lib/with-request.ts           NEW  the wrapper: id, timing, error conversion, logging, system_logs write
backend/src/lib/with-auth.ts              built on withRequest (same behaviour and signature)
backend/src/lib/errors.ts                 toErrorResponse takes the requestId; console.error replaced
backend/src/services/system-log.ts        NEW  writeSystemLog(), purgeOldLogs()
backend/src/services/intake.ts            console.error replaced; uses the request's id for the AI call
backend/prisma/schema.prisma              model SystemLog, enum LogLevel
backend/prisma/migrations/<new>_system_logs/   table, indexes, RLS
backend/app/api/v1/auth/{login,logout}/route.ts, health/route.ts   use withRequest
backend/app/api/internal/purge-logs/route.ts   NEW  cron entry, secret header
backend/vercel.json (or equivalent)       cron schedule, once a day
backend/tests/logging.test.ts             NEW
frontend/lib/types.ts                     error type gains requestId (optional)
docs/architecture-v1.md, README.md        logging section, how to find a request by id
```

## Code style

One wrapper, no logging calls scattered through handlers:

```ts
export const GET = withAuth(async (req, { user }) => { /* unchanged handler */ }, { roles: ["HR_ADMIN"] });

// inside withRequest
const requestId = idFrom(req) ?? randomUUID();
const started = performance.now();
try {
  const res = await handler(req, ctx);
  logRequest({ requestId, req, status: res.status, ms: since(started), userId });
  return withId(res, requestId);
} catch (err) {
  const res = toErrorResponse(err, requestId);          // 500 for unknown errors, with requestId in the envelope
  logRequest({ requestId, req, status: res.status, ms: since(started), userId });
  if (!(err instanceof ApiError)) await writeSystemLog({ event: "http.error", ... });
  return withId(res, requestId);
}
```

Handlers that need the user id for the log get it from the context `withAuth` already builds; no handler is edited except the public routes.

## Testing strategy

- **Logger:** one JSON object per line; reserved key names cannot overwrite `ts`/`level`/`event`; `LOG_LEVEL` is respected.
- **Redaction:** a JWT, `Bearer …`, `?key=`, an email address and a bcrypt hash in an error message do not appear in the stdout line or the row.
- **Request line:** a request logs method, route **pattern** (not the real id), status, duration and `userId`; 2xx is `info`, 4xx `warn`, 5xx `error`; `/health` logs nothing.
- **Request id:** a valid incoming `x-request-id` is kept; an invalid one is replaced; every response, including errors, carries it, and error bodies carry `error.requestId`.
- **500 path:** a handler that throws returns the generic envelope (no stack, no message in the body), writes one `http.error` row with the same `request_id`, and prints one stdout line.
- **Security events:** a wrong password writes `auth.login_failed` with no email and no password anywhere; a 403 writes `auth.forbidden` with the user id; a good login writes `auth.login`.
- **Failure isolation:** with the insert forced to fail, the response is unchanged and `log.write_failed` is printed.
- **Never logged:** a request with a password in the body, a cookie, and a long chat message produces output containing none of them (mutation-check this test by logging the body and confirming it fails).
- **Purge:** rows older than the retention are deleted, newer kept; the route rejects a missing or wrong secret.
- **Existing behaviour:** all current route tests pass unchanged (the wrapper keeps status codes, bodies and headers apart from the added id).
- **Migration:** the table, indexes and RLS exist; drift check is empty.

## Boundaries

- **Always:** log the route pattern, never the URL; redact error text; write to stdout first; keep logging failures from failing a request; run the drift check.
- **Ask first:** logging any request or response body, an email, or an IP anywhere beyond `system_logs`; adding a log-reading page or endpoint; adding a logging library; storing successful requests in the table.
- **Never:** log passwords, hashes, cookies, tokens, keys or message text; add a foreign key from `system_logs` to `users`; let HR Admin or any API read the table; log the attempted email on a failed login.

## Success criteria

1. A failing request returns an `x-request-id`; searching that id in stdout or the table gives the route, status, user, time, error name and redacted stack.
2. Every route, including login, logout and health, goes through the wrapper; no `console.error` remains in `backend/src`.
3. Errors and security events are in `system_logs`; ordinary successful requests are not.
4. No password, token, cookie, message text, email (on failed login) or body ever appears in either output, shown by tests.
5. A logging failure never changes a response.
6. Rows older than the retention are purged on schedule.
7. Backend and frontend tests and the type-check pass; the drift check is empty.

## Open questions

1. **Retention:** 90 days for `system_logs`. OK, or another number?
2. **IP address:** `ip` is personal data. Keep it (useful for attack patterns, the same as `chat_drafts`), or leave it out of the table?
3. **Security events in the table:** is the list in item 6 right (failed login, login, logout, invalid session, 403)? Successful logins add volume (about one row per person per day).
4. **Cron:** the purge needs Vercel Cron (or any scheduler) once deployed. Until then it is run by hand with `npm run logs:purge`.
5. **Outside log service later (Axiom, Sentry):** not part of this change. stdout JSON is what such a service would read, so nothing here blocks it.
