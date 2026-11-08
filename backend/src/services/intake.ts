import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AiErrorCode, ChatDraftOutcome, Prisma, RequestCategoryCode } from "@/generated/prisma/client";
import { AiCallError, requestDraft, type AiDraft } from "@/lib/ai-client";
import type { AuthUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

/**
 * Chat draft (docs/spec-ai-chat-draft.md): one message in, one draft out, nothing saved except the developer record in
 * `chat_drafts`. The AI service only suggests; every value is checked here before it goes back to the browser.
 */

export const chatDraftBody = z
  .object({
    message: z.string().trim().min(1).max(1000),
    /** The page the chat head was opened on. */
    page: z.string().trim().min(1).max(200).startsWith("/"),
  })
  .strict();

/** The categories table has no description column, and the AI needs one. Same text as ai-service/eval/categories.py. */
export const CATEGORY_DESCRIPTIONS: Record<RequestCategoryCode, string> = {
  IT_EQUIPMENT: "Laptops, monitors, keyboards, phones, chargers and other hardware: faults, replacements and new equipment.",
  SOFTWARE_ACCESS: "Accounts, passwords, logins, VPN, licences and access to software or systems, including suspected account compromise.",
  HR_QUERY: "Leave, payroll, benefits, contracts, personal details, workplace concerns and other people questions.",
  FACILITIES: "The office and its furniture and services: desks, chairs, air conditioning, lighting, kitchen, cleaning and building access.",
  OTHER: "Anything that does not fit the other categories.",
};

export interface ChatDraftOrigin {
  ip: string | null;
  userAgent: string | null;
}

export function originOf(req: Request): ChatDraftOrigin {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = (forwarded || req.headers.get("x-real-ip") || "").trim().slice(0, 64);
  return { ip: ip || null, userAgent: req.headers.get("user-agent")?.slice(0, 300) || null };
}

const outcomeOf = (code: AiErrorCode): ChatDraftOutcome => {
  if (code === "AI_TIMEOUT") return "TIMEOUT";
  if (code === "AI_INVALID_OUTPUT" || code === "AI_REJECTED_BY_BACKEND" || code === "AI_BAD_RESPONSE") return "INVALID_OUTPUT";
  return "UNAVAILABLE";
};

/** A code the model returned may be mentioned in the detail only if it looks like a code and not like echoed text. */
const safeCode = (value: string) => (/^[A-Z][A-Z0-9_]{0,39}$/.test(value) ? `"${value}"` : "(not a usable code)");

async function record(row: Prisma.ChatDraftUncheckedCreateInput): Promise<void> {
  // The record is for developers: failing to write it must never fail or delay the employee's draft.
  try {
    await prisma.chatDraft.create({ data: row });
  } catch (e) {
    console.error("chat_drafts: could not write the record", (e as Error)?.name, row.requestId);
  }
}

export async function createChatDraft(actor: AuthUser, input: z.infer<typeof chatDraftBody>, origin: ChatDraftOrigin) {
  const requestId = randomUUID();
  const base = {
    userId: actor.id,
    page: input.page,
    ip: origin.ip,
    userAgent: origin.userAgent,
    requestId,
    messageChars: input.message.length,
  };

  const [categories, departments] = await Promise.all([
    prisma.requestCategory.findMany({ include: { handlingDepartment: { select: { code: true } } }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const fail = async (failure: AiCallError): Promise<never> => {
    await record({
      ...base,
      outcome: outcomeOf(failure.errorCode),
      errorCode: failure.errorCode,
      error: failure.reason,
      errorDetail: failure.detail,
      latencyMs: failure.latencyMs,
    });
    throw new ApiError("AI_UNAVAILABLE", "The assistant can't draft right now. You can still fill in the form yourself.", { requestId });
  };

  let result: { draft: AiDraft; latencyMs: number };
  try {
    result = await requestDraft(
      {
        message: input.message,
        requesterCountry: actor.country,
        requesterDepartment: actor.department.name,
        categories: categories.map((c) => ({
          code: c.code,
          name: c.name,
          description: CATEGORY_DESCRIPTIONS[c.code],
          department: c.handlingDepartment.code,
        })),
        departments: departments.map((d) => ({ code: d.code, name: d.name })),
      },
      requestId,
    );
  } catch (e) {
    return fail(e instanceof AiCallError ? e : new AiCallError("AI_UNREACHABLE", "could not reach the AI service", (e as Error)?.name ?? null));
  }

  const { draft, latencyMs } = result;
  const category = categories.find((c) => c.code === draft.category);
  if (!category) {
    return fail(new AiCallError("AI_REJECTED_BY_BACKEND", "category code was not one we offered", `category code ${safeCode(draft.category)} is not allowed`, latencyMs));
  }
  const department = departments.find((d) => d.code === draft.department);
  if (!department) {
    return fail(new AiCallError("AI_REJECTED_BY_BACKEND", "department code was not one we offered", `department code ${safeCode(draft.department)} is not allowed`, latencyMs));
  }

  await record({
    ...base,
    outcome: "OK",
    attempts: draft.attempts,
    model: draft.model,
    latencyMs,
    categoryId: category.id,
    departmentId: department.id,
    priority: draft.priority,
    confidence: draft.confidence,
    lowConfidence: draft.lowConfidence,
  });

  return {
    title: draft.title.slice(0, 200),
    description: draft.description.slice(0, 5000),
    categoryId: category.id,
    priority: draft.priority,
    departmentId: department.id,
    confidence: draft.confidence,
    lowConfidence: draft.lowConfidence,
    reasoning: draft.reasoning,
  };
}
