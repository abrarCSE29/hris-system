# Spec: system logs for the backend

Status: **v4.** v4: errors and warnings go to stderr, and development prints a coloured short line (your request). v3: you decided to keep the IP address in security-event lines and to accept stdout-only retention for now. v2: no database table (your decision); logs go to stdout only. Source: the conversation on `feature/system-logs`.
Related: `docs/architecture-v1.md`, `ai-service/app/logging.py` (the pattern to follow), `backend/src/lib/{with-auth,errors}.ts`.

## Objective

Today the backend logs almost nothing. Two `console.error` calls exist (`src/lib/errors.ts:47`, `src/services/intake.ts:56`). They print
plain text with no time, level, request id or user. When a request fails there is nothing to tell **when** it happened, **how** (route,
status) or **why** (error and stack). Logins, 401s and 403s leave no trace at all.

This change adds structured logging to the backend: one JSON line per request on stdout, and a full record for every unexpected error.

**For:** developers now, and whoever runs the system. **Success:** given a `requestId` from a failed call, a developer finds what happened,
for which user, on which route, and the error with its stack, without reproducing it.

**Not a goal:** storing logs in the database (decided against for now), a screen or API for reading logs, an audit trail of HR changes
(who changed a person's role; a separate table, separate decision), metrics, alerting, frontend error reporting.

## Assumptions (correct me before approving)

1. **Output: one JSON object per line**, the same idea as the AI service. `debug` and `info` go to stdout; `warn` and `error` go to **stderr**, so a host can flag errors. Nothing is written to the database or to a file. **In development only** (`NODE_ENV=development`) a short coloured line is printed instead (`09:14:02.113 ERROR http.error method=POST route=… status=500`, red for errors, yellow for warnings); production and tests always get JSON.
2. **One wrapper for every route.** A new `withRequest(handler)` in `backend/src/lib/` does, for every request: take or create the request id,
   time the call, run the handler, convert thrown errors to the error envelope, and log. `withAuth` is built on it. The public routes
   (`/auth/login`, `/auth/logout`, `/health`) use it too; today login catches errors itself and `/health` has no wrapper.
3. **Request id.** Taken from an incoming `x-request-id` header if it is a valid UUID, otherwise generated. It is returned on every response as
   the `x-request-id` header and, for errors, inside the envelope as `error.requestId`. The AI call already sends a request id to the AI
   service; it becomes this same id, so one id finds the backend line, the `chat_drafts` row and the AI service's lines.
4. **Per-request line (`http.request`).**
   `ts, level, event, requestId, method, route, status, ms, userId`. `route` is the route **pattern** (`/api/v1/requests/:id`), never the raw URL,
   so ids and query strings (which can carry search text) stay out. `userId` is present when the session was valid. Level: `info` for 2xx and 3xx,
   `warn` for 4xx, `error` for 5xx. `GET /health` is not logged (it is polled).
5. **Error line (`http.error`), for unexpected errors (the 500s).** Adds `errorName`, `errorCode` (for example the Prisma code `P2003`),
   `message` and `stack`, all redacted (item 7). The client still gets only `Internal server error` plus the `requestId`. Expected errors
   (`ApiError`: 401, 403, 404, 409, 422) have no stack; they appear only in the per-request line.
6. **Security events**, each its own line at `warn` (`info` for a good login) with `requestId`, `route`, `userId` when known, and `ip` and
   `userAgent` (truncated to 64 and 300 characters, like `chat_drafts`): `auth.login_failed`, `auth.login`, `auth.logout`,
   `auth.session_invalid` (a 401 on a request that sent a cookie) and `auth.forbidden` (a 403). A failed login records **neither the
   attempted email nor a hash of it**: an email typed into a login box is often a password or a mistyped address and is not needed to see an attack.
7. **What is never logged:** request or response bodies, headers, cookies, the `Authorization` value, passwords, password hashes, tokens, the
   JWT, the AI message text, API keys. Error text can echo values (Prisma and `fetch` errors do), so `message` and `stack` pass through a
   redaction step: remove anything that looks like a bearer token, a JWT, a `key=` or `token=` query value, an email address or a bcrypt
   hash, and cut at a length limit (stack: 8,000 characters). `console.log` of an object is replaced by the logger, so nothing prints un-redacted.
8. **Logger module.** `backend/src/lib/logger.ts` exposes `log(level, event, fields)` and `redact(text)`. Fields named like reserved JSON keys
   cannot overwrite `ts`, `level` or `event` (the AI service has a test for the same crash). The level threshold comes from `LOG_LEVEL`
   (default `info`). A logging failure never changes a response: the logger catches its own errors. The two existing `console.error` calls move to it.
9. **No new dependency.** The logger is about 60 lines over `console.log(JSON.stringify(...))`. A library (`pino`) is not needed at this size.
10. **Retention and search are the host's** (your decision: fine for now). Logs live as long as the host (Vercel) keeps stdout, which is short; if longer keeping or searching is needed later, a log drain to an outside service reads this same JSON without code changes.
11. **Sampling is off.** At ~100 users every request line is kept.
12. **Tests never touch an outside service.** Tests capture stdout.

## Commands

```
cd backend
npm test
npx tsc --noEmit
cd ../frontend && npx tsc --noEmit && npx vitest run      # frontend only gains an optional requestId on the error type
```

No migration and no schema change, so no drift check is needed.

## Project structure (what changes)

```
backend/src/lib/logger.ts                 NEW  log(), redact(), request-id helpers
backend/src/lib/with-request.ts           NEW  the wrapper: id, timing, error conversion, logging
backend/src/lib/with-auth.ts              built on withRequest (same behaviour and signature)
backend/src/lib/errors.ts                 toErrorResponse takes the requestId; console.error replaced
backend/src/services/intake.ts            console.error replaced; uses the request's id for the AI call
backend/app/api/v1/auth/{login,logout}/route.ts, health/route.ts   use withRequest
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
  if (!(err instanceof ApiError)) logError(err, { requestId, route, userId });
  return withId(res, requestId);
}
```

Handlers that need the user id for the log get it from the context `withAuth` already builds; no handler is edited except the public routes.

## Testing strategy

- **Logger:** one JSON object per line; stdout for debug/info and stderr for warn/error; the coloured format only when `NODE_ENV=development`, never in production or test; reserved key names cannot overwrite `ts`/`level`/`event`; `LOG_LEVEL` is respected; a throwing `JSON.stringify` (circular field) does not throw.
- **Redaction:** a JWT, `Bearer …`, `?key=`, an email address and a bcrypt hash in an error message do not appear in the output.
- **Request line:** a request logs method, route **pattern** (not the real id), status, duration and `userId`; 2xx is `info`, 4xx `warn`, 5xx `error`; `/health` logs nothing.
- **Request id:** a valid incoming `x-request-id` is kept; an invalid one is replaced; every response, including errors, carries it, and error bodies carry `error.requestId`.
- **500 path:** a handler that throws returns the generic envelope (no stack, no message in the body) and prints one `http.error` line with the same `requestId`.
- **Security events:** a wrong password logs `auth.login_failed` with no email and no password anywhere in the output; a 403 logs `auth.forbidden` with the user id; a good login logs `auth.login`.
- **Never logged:** a request with a password in the body, a cookie, and a long chat message produces output containing none of them (mutation-check: log the body and confirm the test fails).
- **Existing behaviour:** all current route tests pass unchanged (the wrapper keeps status codes and bodies; it only adds the id).

## Boundaries

- **Always:** log the route pattern, never the URL; redact error text; keep logging failures from failing a request.
- **Ask first:** logging any request or response body or an email; storing logs anywhere but stdout (a table, a file); adding a logging library or an outside service.
- **Never:** log passwords, hashes, cookies, tokens, keys or message text; log the attempted email on a failed login.

## Success criteria

1. A failing request returns an `x-request-id`; searching that id in the output gives the route, status, user, time, error name and redacted stack.
2. Every route, including login, logout and health, goes through the wrapper; no `console.error` remains in `backend/src`.
3. Security events (failed login, login, logout, invalid session, 403) are logged.
4. No password, token, cookie, message text, email (on failed login) or body ever appears in the output, shown by tests.
5. A logging failure never changes a response.
6. Backend and frontend tests and the type-check pass.

## Open questions

- None blocking. Decided: IP address kept in security-event lines; stdout-only retention accepted for now. The security-event list in item 6
  stands unless you change it.
