import type { RoleCode } from "./lookups";
import { SESSION_COOKIE, getAuthUser, readCookie, type AuthUser } from "./auth";
import { ApiError } from "./errors";
import { withRequest, type RequestContext } from "./with-request";

export interface AuthContext<P> {
  user: AuthUser;
  /** Route params; a promise in Next.js 16. */
  params: Promise<P>;
  /** The id of this request (also the `x-request-id` header), for passing on to other services. */
  requestId: string;
  /** Writes a security event line, for example `auth.logout`. */
  audit: RequestContext<unknown>["audit"];
}

/**
 * Wraps a route handler: verifies the session, loads the user fresh from the database
 * (so role changes apply immediately), rejects disallowed roles with 403, and converts
 * thrown ApiErrors into the spec's error envelope. 401 is checked before 403. Built on `withRequest`,
 * so every request also gets an id and a log line that names the user.
 */
export function withAuth<P = Record<string, never>>(
  handler: (req: Request, ctx: AuthContext<P>) => Promise<Response> | Response,
  options: { roles?: RoleCode[] } = {},
) {
  return withRequest<P>(async (req, ctx) => {
    const user = await getAuthUser(req);
    if (!user) {
      // A cookie that does not give a user (expired, forged, or its user is gone) is worth a trace; no cookie at all is not.
      if (readCookie(req, SESSION_COOKIE)) await ctx.audit("auth.session_invalid");
      throw new ApiError("UNAUTHORIZED", "Authentication required");
    }
    ctx.meta.userId = user.id;
    if (options.roles && !options.roles.includes(user.role.code as RoleCode)) {
      await ctx.audit("auth.forbidden");
      throw new ApiError("FORBIDDEN", "You do not have access to this resource");
    }
    return handler(req, { user, params: ctx.params, requestId: ctx.requestId, audit: ctx.audit });
  });
}
