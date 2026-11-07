import { NextResponse } from "next/server";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "CONFLICT"
  | "VALIDATION_FAILED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  CONFLICT: 409,
  VALIDATION_FAILED: 422,
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

export function errorResponse(err: ApiError): NextResponse {
  const body: { error: { code: ErrorCode; message: string; details?: unknown } } = {
    error: { code: err.code, message: err.message },
  };
  if (err.details !== undefined) body.error.details = err.details;
  return NextResponse.json(body, { status: err.status });
}

/** Converts any thrown value into the spec's error envelope. Unknown errors become a generic 500. */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) return errorResponse(err);
  console.error(err);
  return errorResponse(new ApiError("INTERNAL", "Internal server error"));
}
