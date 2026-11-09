import { randomUUID } from "node:crypto";
import { toErrorResponse } from "./errors";
import { log, type LogLevel } from "./logger";
import { originOf } from "./origin";

/**
 * Wraps every route (docs/spec-system-logs.md): gives the request an id, times it, turns a thrown error into the error envelope,
 * and writes the `http.request` line. Unexpected errors are logged as `http.error` by `toErrorResponse`.
 *
 * Security events (`auth.login`, `auth.login_failed`, `auth.logout`, `auth.session_invalid`, `auth.forbidden`) are written by
 * `ctx.audit(event)`: request id, route, the user if known, and the caller's ip and user agent. Callers pass no other data, so an
 * email, password or token cannot reach the line.
 *
 * What is logged: method, the route PATTERN (dynamic segments shown as `:id`, no query string), status, duration, request id and
 * the signed-in user's id. Never a body, header, cookie, password or message text.
 */

export interface RequestContext<P> {
  requestId: string;
  /** Route params; a promise in Next.js 16. */
  params: Promise<P>;
  /** Filled in by the handler or by `withAuth` so the log line can name the user. */
  meta: { userId?: string };
  /** Writes a security event line (warn unless a level is given). */
  audit: (event: SecurityEvent, level?: LogLevel) => Promise<void>;
}

export type SecurityEvent = "auth.login" | "auth.login_failed" | "auth.logout" | "auth.session_invalid" | "auth.forbidden";

interface RouteContext<P> {
  params: Promise<P>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A caller's id is kept only if it is a UUID, so nothing else (a forged line, a long string) can reach the logs. */
function incomingId(req: Request): string | null {
  const value = req.headers.get("x-request-id")?.trim();
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

/** `/api/v1/requests/<id>/comments` becomes `/api/v1/requests/:id/comments`, using the names of the route's own params. */
function routePattern(req: Request, params: Record<string, unknown>): string {
  const named = Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string");
  return new URL(req.url).pathname
    .split("/")
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        // keep the raw segment for the comparison
      }
      const hit = named.find(([, value]) => value === decoded || value === segment);
      return hit ? `:${hit[0]}` : segment;
    })
    .join("/");
}

function withRequestId(res: Response, requestId: string): Response {
  try {
    res.headers.set("x-request-id", requestId);
    return res;
  } catch {
    // Some responses (a redirect built with Response.redirect) have immutable headers: copy them.
    const headers = new Headers(res.headers);
    headers.set("x-request-id", requestId);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
}

const levelOf = (status: number) => (status >= 500 ? "error" : status >= 400 ? "warn" : "info");

export function withRequest<P = Record<string, never>>(
  handler: (req: Request, ctx: RequestContext<P>) => Promise<Response> | Response,
  options: { /** Set the id but write no line (the health check is polled). */ silent?: boolean } = {},
) {
  return async (req: Request, routeCtx?: RouteContext<P>): Promise<Response> => {
    const requestId = incomingId(req) ?? randomUUID();
    const params = routeCtx?.params ?? Promise.resolve({} as P);
    const meta: RequestContext<P>["meta"] = {};
    const started = performance.now();
    const where = async () => ({
      method: req.method,
      route: routePattern(req, (await params.catch(() => ({}))) as Record<string, unknown>),
      userId: meta.userId,
    });

    const audit = async (event: SecurityEvent, level: LogLevel = "warn") => {
      const { ip, userAgent } = originOf(req);
      log(level, event, { requestId, ...(await where()), ip: ip ?? undefined, userAgent: userAgent ?? undefined });
    };

    let res: Response;
    try {
      res = await handler(req, { requestId, params, meta, audit });
    } catch (err) {
      res = toErrorResponse(err, requestId, await where());
    }

    if (!options.silent) {
      log(levelOf(res.status), "http.request", { requestId, ...(await where()), status: res.status, ms: Math.round(performance.now() - started) });
    }
    return withRequestId(res, requestId);
  };
}
