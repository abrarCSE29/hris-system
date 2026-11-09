import { NextResponse } from "next/server";
import { logUnexpected } from "./logger";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "CONFLICT"
  | "VALIDATION_FAILED"
  | "AI_UNAVAILABLE"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  CONFLICT: 409,
  VALIDATION_FAILED: 422,
  AI_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export function errorResponse(err: ApiError, requestId?: string): NextResponse {
  const body: { error: { code: ErrorCode; message: string; details?: unknown; requestId?: string } } = {
    error: { code: err.code, message: err.message },
  };
  if (err.details !== undefined) body.error.details = err.details;
  if (requestId) body.error.requestId = requestId;
  return NextResponse.json(body, { status: err.status });
}

/**
 * Converts any thrown value into the spec's error envelope. Unknown errors become a generic 500 (nothing of the error is returned)
 * and are logged as `http.error`, with `context` (route, method, user) added to the line.
 */
export function toErrorResponse(err: unknown, requestId?: string, context: Record<string, unknown> = {}): NextResponse {
  if (err instanceof ApiError) return errorResponse(err, requestId);
  logUnexpected(err, { requestId, ...context });
  return errorResponse(new ApiError("INTERNAL", "Internal server error"), requestId);
}
