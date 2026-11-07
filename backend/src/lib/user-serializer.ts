import type { Prisma } from "@/generated/prisma/client";

/** Prisma include that every user response needs. */
export const userInclude = {
  department: { select: { id: true, code: true, name: true } },
} satisfies Prisma.UserInclude;

type UserWithDepartment = Prisma.UserGetPayload<{ include: typeof userInclude }>;

/** The public user shape from the API spec (§4.2). Never includes the password hash. */
export function serializeUser(u: UserWithDepartment) {
  return {
    id: u.id,
    employeeCode: u.employeeCode,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    country: u.country,
    department: u.department,
    managerId: u.managerId,
    jobTitle: u.jobTitle,
    status: u.status,
    joiningDate: u.joiningDate.toISOString().slice(0, 10),
  };
}

export type PublicUser = ReturnType<typeof serializeUser>;
