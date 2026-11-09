import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { hashPassword, type AuthUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { requireLookupId } from "@/lib/lookup-ids";
import { NEW_USER_STATUS_CODES } from "@/lib/lookups";
import { paginated, type Paging } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { isoDate } from "@/lib/validation";
import { serializeUser, userInclude } from "@/lib/user-serializer";
import { createChecklist } from "./onboarding";
import { scopeUsers } from "./policy";
import { ASSIGNABLE_STATUSES } from "./state-machine";

// ── list ─────────────────────────────────────────────────────────────────────

export const listUsersQuery = z.object({
  search: z.string().trim().min(1).optional(),
  /** Role, country and status are filtered by id (the ids come from GET /meta). */
  countryId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  statusId: z.uuid().optional(),
  roleId: z.uuid().optional(),
});

/** Query-string values that are empty ("?countryId=") count as absent. */
export function queryObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of params) if (v !== "") out[k] = v;
  return out;
}

export async function listUsers(actor: AuthUser, q: z.infer<typeof listUsersQuery>, paging: Paging) {
  await Promise.all([requireLookupId("country", q.countryId, "countryId"), requireLookupId("status", q.statusId, "statusId"), requireLookupId("role", q.roleId, "roleId")]);
  const filters: Prisma.UserWhereInput = {
    countryId: q.countryId,
    departmentId: q.departmentId,
    statusId: q.statusId,
    roleId: q.roleId,
    ...(q.search && {
      OR: [
        { fullName: { contains: q.search, mode: "insensitive" } },
        { email: { contains: q.search, mode: "insensitive" } },
        { employeeCode: { contains: q.search, mode: "insensitive" } },
      ],
    }),
  };
  const where: Prisma.UserWhereInput = { AND: [scopeUsers(actor), filters] };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: userInclude,
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      skip: paging.skip,
      take: paging.take,
    }),
    prisma.user.count({ where }),
  ]);
  return paginated(rows.map(serializeUser), total, paging);
}

// ── assignable ───────────────────────────────────────────────────────────────

/** Members who can be given work: everyone except people on notice. */
export async function listAssignable(actor: AuthUser, departmentId: string) {
  if (actor.role.code !== "HR_ADMIN" && actor.headOfDepartmentId !== departmentId) {
    throw new ApiError("FORBIDDEN", "You can only list members of a department you head");
  }
  const rows = await prisma.user.findMany({
    where: { departmentId, status: { code: { in: ASSIGNABLE_STATUSES } } },
    select: { id: true, employeeCode: true, fullName: true, jobTitle: true },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
  });
  return { data: rows };
}

// ── create ───────────────────────────────────────────────────────────────────

export const createUserBody = z
  .object({
    fullName: z.string().trim().min(1).max(120),
    // Normalise first, then validate, so " Ana@Example.com " is accepted and stored as "ana@example.com".
    email: z.string().trim().toLowerCase().pipe(z.email()),
    countryId: z.uuid(),
    /** The person's role (an id from GET /meta). Defaults to Employee. A Manager heads their department, and there is one per department. */
    roleId: z.uuid().optional(),
    departmentId: z.uuid(),
    managerId: z.uuid(),
    jobTitle: z.string().trim().min(1).max(120),
    joiningDate: isoDate,
    /** Optional: HR chooses the initial password; otherwise one is generated and returned once. */
    password: z.string().min(10).max(128).optional(),
    /** Employment status to start with (an id from GET /meta). Defaults to probation; "on notice" makes no sense for a new person. */
    statusId: z.uuid().optional(),
    /** Optional: also create this onboarding checklist for the new user, in the same transaction. */
    templateId: z.uuid().optional(),
  })
  // Unknown keys are rejected rather than silently dropped.
  .strict();

/** Must be given the transaction client when called inside a transaction (the pool may have one connection). */
async function nextEmployeeCode(db: Prisma.TransactionClient): Promise<string> {
  const [row] = await db.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING(employee_code FROM 5) AS INTEGER))::int AS max
    FROM users WHERE employee_code ~ '^EMP-[0-9]+$'`;
  return `EMP-${String((row?.max ?? 0) + 1).padStart(4, "0")}`;
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function createUser(input: z.infer<typeof createUserBody>) {
  const [department, manager, existing, country, status, role] = await Promise.all([
    prisma.department.findUnique({ where: { id: input.departmentId }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: input.managerId }, select: { id: true, role: { select: { code: true } } } }),
    prisma.user.findUnique({ where: { email: input.email }, select: { id: true } }),
    prisma.country.findUnique({ where: { id: input.countryId }, select: { id: true } }),
    input.statusId
      ? prisma.userStatus.findUnique({ where: { id: input.statusId }, select: { id: true, code: true } })
      : prisma.userStatus.findUnique({ where: { code: "ON_PROBATION" }, select: { id: true, code: true } }),
    input.roleId
      ? prisma.role.findUnique({ where: { id: input.roleId }, select: { id: true, code: true } })
      : prisma.role.findUnique({ where: { code: "EMPLOYEE" }, select: { id: true, code: true } }),
  ]);
  if (!country) throw new ApiError("VALIDATION_FAILED", "Unknown country", [{ path: "countryId", message: "Country not found" }]);
  if (!status || !(NEW_USER_STATUS_CODES as readonly string[]).includes(status.code)) {
    throw new ApiError("VALIDATION_FAILED", "A new person starts as Active or On probation", [{ path: "statusId", message: "Must be Active or On probation" }]);
  }
  if (!role) {
    if (!input.roleId) throw new Error("The EMPLOYEE role is missing from the roles table");
    throw new ApiError("VALIDATION_FAILED", "Unknown role", [{ path: "roleId", message: "Role not found" }]);
  }
  if (!department) throw new ApiError("VALIDATION_FAILED", "Unknown department", [{ path: "departmentId", message: "Department not found" }]);
  if (!manager || manager.role.code !== "MANAGER") {
    throw new ApiError("VALIDATION_FAILED", "Manager must be an existing user with the Manager role", [
      { path: "managerId", message: "Not a manager" },
    ]);
  }
  if (existing) throw new ApiError("CONFLICT", "A user with this email already exists");
  if (role.code === "MANAGER") {
    // A Manager is the head of their department, and a department has one for now.
    const current = await prisma.user.findFirst({ where: { departmentId: input.departmentId, role: { code: "MANAGER" } }, select: { id: true } });
    if (current) throw new ApiError("VALIDATION_FAILED", "This department already has a Manager", [{ path: "roleId", message: "This department already has a Manager" }]);
  }

  if (input.templateId) {
    const template = await prisma.onboardingTemplate.findUnique({ where: { id: input.templateId }, select: { id: true } });
    if (!template) throw new ApiError("VALIDATION_FAILED", "Unknown template", [{ path: "templateId", message: "Template not found" }]);
  }

  const generated = input.password ? undefined : randomBytes(12).toString("base64url");
  const passwordHash = await hashPassword(input.password ?? generated!);
  const { password: _password, joiningDate, templateId, statusId: _statusId, roleId: _roleId, countryId, ...fields } = input;

  // Employee codes are max+1; if two creates race, the unique index rejects one and we retry.
  // Each attempt is its own transaction: the user and their checklist are created together or not at all.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { user, onboarding } = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            ...fields,
            joiningDate: new Date(`${joiningDate}T00:00:00Z`),
            employeeCode: await nextEmployeeCode(tx),
            passwordHash,
            roleId: role.id,
            countryId,
            statusId: status.id,
          },
          include: userInclude,
        });
        // A new Manager becomes the department's listed head when it has none (the head is only a label; permissions come from the role).
        if (role.code === "MANAGER") await tx.department.updateMany({ where: { id: input.departmentId, headId: null }, data: { headId: user.id } });
        // The new hire starts on their joining date.
        const onboarding = templateId ? await createChecklist(tx, { employeeId: user.id, templateId, startDate: joiningDate }) : null;
        return { user, onboarding };
      });
      return {
        user: serializeUser(user),
        ...(onboarding && { onboarding }),
        ...(generated && { temporaryPassword: generated }),
      };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const taken = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
      if (taken) throw new ApiError("CONFLICT", "A user with this email already exists");
    }
  }
  throw new ApiError("CONFLICT", "Could not allocate an employee code, please retry");
}
