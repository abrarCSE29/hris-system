import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Country, Prisma, Role, UserStatus } from "@/generated/prisma/client";
import { hashPassword, type AuthUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { paginated, type Paging } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { isoDate } from "@/lib/validation";
import { serializeUser, userInclude } from "@/lib/user-serializer";
import { createChecklist } from "./onboarding";
import { scopeUsers } from "./policy";

// ── list ─────────────────────────────────────────────────────────────────────

export const listUsersQuery = z.object({
  search: z.string().trim().min(1).optional(),
  country: z.enum(Country).optional(),
  departmentId: z.uuid().optional(),
  status: z.enum(UserStatus).optional(),
  role: z.enum(Role).optional(),
});

/** Query-string values that are empty ("?country=") count as absent. */
export function queryObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of params) if (v !== "") out[k] = v;
  return out;
}

export async function listUsers(actor: AuthUser, q: z.infer<typeof listUsersQuery>, paging: Paging) {
  const filters: Prisma.UserWhereInput = {
    country: q.country,
    departmentId: q.departmentId,
    status: q.status,
    role: q.role,
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
  if (actor.role !== "HR_ADMIN" && actor.headOfDepartmentId !== departmentId) {
    throw new ApiError("FORBIDDEN", "You can only list members of a department you head");
  }
  const rows = await prisma.user.findMany({
    where: { departmentId, status: { in: ["ACTIVE", "ON_PROBATION"] } },
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
    country: z.enum(Country),
    departmentId: z.uuid(),
    managerId: z.uuid(),
    jobTitle: z.string().trim().min(1).max(120),
    joiningDate: isoDate,
    /** Optional: HR chooses the initial password; otherwise one is generated and returned once. */
    password: z.string().min(10).max(128).optional(),
    /** Employment status to start with. Defaults to probation; "on notice" makes no sense for a new person. */
    status: z.enum(["ACTIVE", "ON_PROBATION"]).default("ON_PROBATION"),
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
  const [department, manager, existing] = await Promise.all([
    prisma.department.findUnique({ where: { id: input.departmentId }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: input.managerId }, select: { id: true, role: true } }),
    prisma.user.findUnique({ where: { email: input.email }, select: { id: true } }),
  ]);
  if (!department) throw new ApiError("VALIDATION_FAILED", "Unknown department", [{ path: "departmentId", message: "Department not found" }]);
  if (!manager || manager.role !== "MANAGER") {
    throw new ApiError("VALIDATION_FAILED", "Manager must be an existing user with the Manager role", [
      { path: "managerId", message: "Not a manager" },
    ]);
  }
  if (existing) throw new ApiError("CONFLICT", "A user with this email already exists");

  if (input.templateId) {
    const template = await prisma.onboardingTemplate.findUnique({ where: { id: input.templateId }, select: { id: true } });
    if (!template) throw new ApiError("VALIDATION_FAILED", "Unknown template", [{ path: "templateId", message: "Template not found" }]);
  }

  const generated = input.password ? undefined : randomBytes(12).toString("base64url");
  const passwordHash = await hashPassword(input.password ?? generated!);
  const { password: _password, joiningDate, templateId, ...fields } = input;

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
            role: "EMPLOYEE",
          },
          include: userInclude,
        });
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
