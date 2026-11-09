import { z } from "zod";
import { Prisma, RequestChannel, RequestPriority, RequestStatus } from "@/generated/prisma/client";
import type { AuthUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import type { StatusCode } from "@/lib/lookups";
import { requireLookupId } from "@/lib/lookup-ids";
import { paginated, type Paging } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { scopeRequests } from "./policy";
import { allowedActions, checkTransition, type Actor } from "./state-machine";

/** What the workflow rules need to know about the signed-in person: their role as a code, not the database row. */
const toActor = (u: AuthUser): Actor => ({ id: u.id, role: u.role.code as Actor["role"], headOfDepartmentId: u.headOfDepartmentId });

// ── input schemas ────────────────────────────────────────────────────────────

export const createRequestBody = z
  .object({
    categoryId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(5000),
    priority: z.enum(RequestPriority),
    // Optional: send it to a different department than the category's (the chat assistant's draft lets the employee choose).
    handlingDepartmentId: z.uuid().optional(),
    // How it was raised. The chat assistant sends CHAT; it only labels the request for the person's own history.
    channel: z.enum(RequestChannel).optional(),
  })
  .strict();

export const listRequestsQuery = z.object({
  status: z.enum(RequestStatus).optional(),
  categoryId: z.uuid().optional(),
  priority: z.enum(RequestPriority).optional(),
  /** Country of the person who submitted the request. */
  countryId: z.uuid().optional(),
  channel: z.enum(RequestChannel).optional(),
  /** "true": only requests the signed-in person raised themselves (a Manager or HR Admin otherwise sees more). */
  mine: z.enum(["true", "false"]).optional(),
});

export const transitionBody = z
  .object({
    action: z.enum(["assign", "start", "resolve", "close"]),
    assigneeId: z.uuid().optional(),
    note: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .refine((b) => b.action === "assign" || b.assigneeId === undefined, {
    path: ["assigneeId"],
    message: "assigneeId only applies to the assign action",
  });

export const commentBody = z.object({ body: z.string().trim().min(1).max(5000) }).strict();

// ── output shape ─────────────────────────────────────────────────────────────

const summaryInclude = {
  category: { select: { id: true, code: true, name: true } },
  handlingDepartment: { select: { id: true, code: true, name: true } },
  requester: { select: { id: true, fullName: true, country: { select: { id: true, shortcode: true, name: true } } } },
  assignee: { select: { id: true, fullName: true } },
} satisfies Prisma.ServiceRequestInclude;

type RequestRow = Prisma.ServiceRequestGetPayload<{ include: typeof summaryInclude }>;

function serializeSummary(r: RequestRow) {
  return {
    id: r.id,
    reference: r.reference,
    title: r.title,
    priority: r.priority,
    status: r.status,
    channel: r.channel,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    category: r.category,
    handlingDepartment: r.handlingDepartment,
    requester: r.requester,
    assignee: r.assignee,
  };
}

const notFound = () => new ApiError("NOT_FOUND", "Request not found");

/** Looks a request up together with the user's scope: anything outside it is simply "not found". */
async function findInScope(actor: AuthUser, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound();
  const row = await prisma.serviceRequest.findFirst({
    where: { AND: [{ id }, scopeRequests(actor)] },
    include: summaryInclude,
  });
  if (!row) throw notFound();
  return row;
}

// ── operations ───────────────────────────────────────────────────────────────

export async function createRequest(actor: AuthUser, input: z.infer<typeof createRequestBody>) {
  const category = await prisma.requestCategory.findUnique({ where: { id: input.categoryId } });
  if (!category) {
    throw new ApiError("VALIDATION_FAILED", "Unknown category", [{ path: "categoryId", message: "Category not found" }]);
  }
  // The requester may choose where it goes; otherwise it goes to the category's department.
  let handlingDepartmentId = category.handlingDepartmentId;
  if (input.handlingDepartmentId && input.handlingDepartmentId !== handlingDepartmentId) {
    const department = await prisma.department.findUnique({ where: { id: input.handlingDepartmentId }, select: { id: true } });
    if (!department) {
      throw new ApiError("VALIDATION_FAILED", "Unknown department", [{ path: "handlingDepartmentId", message: "Department not found" }]);
    }
    handlingDepartmentId = department.id;
  }
  // The request and its first history row are written together or not at all.
  const created = await prisma.$transaction(async (tx) => {
    const request = await tx.serviceRequest.create({
      data: {
        requesterId: actor.id,
        categoryId: category.id,
        // Copied now, so later re-routing of a category doesn't move existing requests.
        handlingDepartmentId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        channel: input.channel ?? "FORM",
      },
      include: summaryInclude,
    });
    await tx.requestEvent.create({
      data: { requestId: request.id, fromStatus: null, toStatus: "SUBMITTED", actorId: actor.id },
    });
    return request;
  });
  return serializeSummary(created);
}

export async function listRequests(actor: AuthUser, q: z.infer<typeof listRequestsQuery>, paging: Paging) {
  await requireLookupId("country", q.countryId, "countryId");
  const filters: Prisma.ServiceRequestWhereInput = {
    status: q.status,
    categoryId: q.categoryId,
    priority: q.priority,
    channel: q.channel,
    ...(q.mine === "true" && { requesterId: actor.id }),
    ...(q.countryId && { requester: { countryId: q.countryId } }),
  };
  const where: Prisma.ServiceRequestWhereInput = { AND: [scopeRequests(actor), filters] };
  const [rows, total] = await Promise.all([
    prisma.serviceRequest.findMany({
      where,
      include: summaryInclude,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: paging.skip,
      take: paging.take,
    }),
    prisma.serviceRequest.count({ where }),
  ]);
  return paginated(rows.map(serializeSummary), total, paging);
}

export async function getRequestDetail(actor: AuthUser, id: string) {
  const request = await findInScope(actor, id);
  const [events, comments] = await Promise.all([
    prisma.requestEvent.findMany({
      where: { requestId: request.id },
      include: { actor: { select: { id: true, fullName: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.requestComment.findMany({
      where: { requestId: request.id },
      include: { author: { select: { id: true, fullName: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);

  // Events store the assignee as a plain id (history must survive user changes); resolve names here.
  const assigneeIds = [...new Set(events.map((e) => e.assigneeId).filter((x): x is string => x !== null))];
  const names = new Map(
    (await prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]),
  );

  return {
    ...serializeSummary(request),
    description: request.description,
    events: events.map((e) => ({
      id: e.id,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actor: e.actor,
      assignee: e.assigneeId ? { id: e.assigneeId, fullName: names.get(e.assigneeId) ?? "Unknown" } : null,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    })),
    comments: comments.map((c) => ({ id: c.id, body: c.body, author: c.author, createdAt: c.createdAt.toISOString() })),
    allowedActions: allowedActions(request, toActor(actor)),
  };
}

export async function addComment(actor: AuthUser, id: string, input: z.infer<typeof commentBody>) {
  const request = await findInScope(actor, id);
  // Author and timestamp are always set here, never taken from the client.
  const comment = await prisma.requestComment.create({
    data: { requestId: request.id, authorId: actor.id, body: input.body },
    include: { author: { select: { id: true, fullName: true } } },
  });
  return { id: comment.id, body: comment.body, author: comment.author, createdAt: comment.createdAt.toISOString() };
}

/**
 * Applies a workflow action (assign / start / resolve / close).
 * The state machine decides if it is allowed; this function loads the data and saves the result:
 * the new status and its history row are written in one transaction.
 */
export async function transitionRequest(actor: AuthUser, id: string, input: z.infer<typeof transitionBody>) {
  const request = await findInScope(actor, id);

  const candidate =
    input.action === "assign" && input.assigneeId
      ? await prisma.user.findUnique({
          where: { id: input.assigneeId },
          select: { id: true, departmentId: true, status: { select: { code: true } } },
        })
      : null;

  const result = checkTransition(
    input.action,
    request,
    toActor(actor),
    candidate && { id: candidate.id, departmentId: candidate.departmentId, status: candidate.status.code as StatusCode },
  );
  if (!result.ok) {
    if (result.reason === "invalid_assignee") {
      throw new ApiError("VALIDATION_FAILED", result.message, [{ path: "assigneeId", message: result.message }]);
    }
    throw new ApiError("INVALID_TRANSITION", result.message);
  }

  await prisma.$transaction(async (tx) => {
    // Guard against a concurrent change (e.g. a double click): only update if the request is still
    // exactly as we read it. If someone else got there first, nothing is written.
    const { count } = await tx.serviceRequest.updateMany({
      where: { id: request.id, status: request.status, assigneeId: request.assigneeId },
      data: { status: result.to, assigneeId: result.assigneeId },
    });
    if (count === 0) throw new ApiError("INVALID_TRANSITION", "This request was changed by someone else. Reload and try again.");
    await tx.requestEvent.create({
      data: {
        requestId: request.id,
        fromStatus: result.from,
        toStatus: result.to,
        actorId: actor.id,
        assigneeId: input.action === "assign" ? result.assigneeId : null,
        note: input.note ?? null,
      },
    });
  });

  return getRequestDetail(actor, request.id);
}
