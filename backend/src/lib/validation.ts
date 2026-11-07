import { z } from "zod";
import { ApiError } from "./errors";

/** Parses data with a zod schema; failures become a 422 with per-field issues. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Validation failed",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

/** Reads a JSON body; malformed JSON is a validation error, not a 500. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Request body must be valid JSON");
  }
}

export const isoDate = z.iso.date();
