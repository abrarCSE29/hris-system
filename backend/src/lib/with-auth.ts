import type { Role } from "@/generated/prisma/client";
import { getAuthUser, type AuthUser } from "./auth";
import { ApiError, toErrorResponse } from "./errors";

export interface AuthContext<P> {
  user: AuthUser;
  /** Route params; a promise in Next.js 16. */
  params: Promise<P>;
}

interface RouteContext<P> {
  params: Promise<P>;
}

/**
 * Wraps a route handler: verifies the session, loads the user fresh from the database
 * (so role changes apply immediately), rejects disallowed roles with 403, and converts
 * thrown ApiErrors into the spec's error envelope. 401 is checked before 403.
 */
export function withAuth<P = Record<string, never>>(
  handler: (req: Request, ctx: AuthContext<P>) => Promise<Response> | Response,
  options: { roles?: Role[] } = {},
) {
  return async (req: Request, ctx?: RouteContext<P>): Promise<Response> => {
    try {
      const user = await getAuthUser(req);
      if (!user) throw new ApiError("UNAUTHORIZED", "Authentication required");
      if (options.roles && !options.roles.includes(user.role)) {
        throw new ApiError("FORBIDDEN", "You do not have access to this resource");
      }
      return await handler(req, { user, params: ctx?.params ?? Promise.resolve({} as P) });
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}
