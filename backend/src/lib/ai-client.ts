import { z } from "zod";
import type { AiErrorCode } from "@/generated/prisma/client";

/**
 * Calls the private AI service. It only ever sends what the caller gives it, and a failure carries a cause in words (and
 * the AI service's already-redacted trace), never the request body, so the employee's message cannot reach an error.
 */

/** The AI service allows its model 20 seconds; this is a little longer so the AI service's own answer wins the race. */
export const AI_TIMEOUT_MS = 25_000;

export interface AiDraftRequest {
  message: string;
  requesterCountry: string;
  requesterDepartment: string;
  categories: { code: string; name: string; description: string; department: string }[];
  departments: { code: string; name: string }[];
}

const aiDraft = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  department: z.string().min(1),
  confidence: z.number().min(0).max(1),
  lowConfidence: z.boolean(),
  reasoning: z.string(),
  model: z.string(),
  latencyMs: z.number().int().nonnegative(),
  attempts: z.number().int().min(1).max(2),
});
export type AiDraft = z.infer<typeof aiDraft>;

export class AiCallError extends Error {
  constructor(
    readonly errorCode: AiErrorCode,
    /** The cause in a few words, for people. */
    readonly reason: string,
    /** The AI service's redacted trace, or our own detail. Never message text. */
    readonly detail: string | null = null,
    readonly latencyMs: number | null = null,
  ) {
    super(reason);
  }
}

const trim = (text: string | null | undefined, max = 4000) => (text ? text.slice(0, max) : null);

function fromFailureStatus(status: number, body: unknown): AiCallError {
  const err = (body as { error?: { code?: string; type?: string; detail?: string } } | null)?.error;
  const detail = trim([err?.type, err?.detail].filter(Boolean).join("\n"));
  if (status === 401 || status === 403) return new AiCallError("AI_AUTH", `AI service returned ${status}`, detail);
  if (status === 429) return new AiCallError("AI_RATE_LIMITED", "AI service returned 429 (rate limited)", detail);
  if (status === 504 || status === 408) return new AiCallError("AI_TIMEOUT", `AI service returned ${status} (timed out)`, detail);
  if (status === 502 && err?.code === "INVALID_OUTPUT") return new AiCallError("AI_INVALID_OUTPUT", "invalid output after retry", detail);
  if (status === 422) return new AiCallError("AI_BAD_RESPONSE", "AI service rejected the request body (422)", detail);
  return new AiCallError("AI_MODEL_ERROR", `AI service returned ${status}${err?.code ? ` (${err.code})` : ""}`, detail);
}

/** Network failures: Node's fetch wraps the real cause (for example ECONNREFUSED) in `cause`. */
function fromThrown(e: unknown): AiCallError {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new AiCallError("AI_TIMEOUT", `timed out after ${AI_TIMEOUT_MS / 1000}s`, name);
  }
  const code = (e as { cause?: { code?: string } })?.cause?.code;
  const reason = code === "ECONNREFUSED" ? "connection refused" : code === "ENOTFOUND" ? "host not found" : "could not reach the AI service";
  return new AiCallError("AI_UNREACHABLE", reason, trim([name, code].filter(Boolean).join(": ")));
}

export async function requestDraft(payload: AiDraftRequest, requestId: string): Promise<{ draft: AiDraft; latencyMs: number }> {
  const url = process.env.AI_SERVICE_URL;
  const token = process.env.AI_SERVICE_TOKEN;
  if (!url || !token) {
    throw new AiCallError("AI_UNREACHABLE", "AI service URL or token is not configured", "AI_SERVICE_URL or AI_SERVICE_TOKEN is empty");
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/$/, "")}/v1/draft`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-token": token, "x-request-id": requestId },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (e) {
    const failure = fromThrown(e);
    throw new AiCallError(failure.errorCode, failure.reason, failure.detail, Date.now() - started);
  }
  const latencyMs = Date.now() - started;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // not JSON; handled below
  }
  if (!res.ok) {
    const failure = fromFailureStatus(res.status, body);
    throw new AiCallError(failure.errorCode, failure.reason, failure.detail, latencyMs);
  }
  const parsed = aiDraft.safeParse(body);
  if (!parsed.success) {
    // Field names and problems only: the issues' received values are not included.
    const where = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`).join("; ");
    throw new AiCallError("AI_BAD_RESPONSE", "AI service answered in an unexpected shape", trim(where), latencyMs);
  }
  return { draft: parsed.data, latencyMs };
}
