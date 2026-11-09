import type { RoleCode } from "./lookups";
import { getAuthUser, type AuthUser } from "./auth";
import { ApiError } from "./errors";
import { withRequest } from "./with-request";

export interface AuthContext<P> {
  user: AuthUser;
  /** Route params; a promise in Next.js 16. */
  params: Promise<P>;
  /** The id of this request (also the `x-request-id` header), for passing on to other services. */
  requestId: string;
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
    if (!user) throw new ApiError("UNAUTHORIZED", "Authentication required");
    ctx.meta.userId = user.id;
    if (options.roles && !options.roles.includes(user.role.code as RoleCode)) {
      throw new ApiError("FORBIDDEN", "You do not have access to this resource");
    }
    return handler(req, { user, params: ctx.params, requestId: ctx.requestId });
  });
}
