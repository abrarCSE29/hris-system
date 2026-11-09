import { createPrismaClient } from "@/lib/create-prisma";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { RoleCode, StatusCode } from "@/lib/lookups";

export const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://hris:hris@localhost:5433/hris_test";

export const db: PrismaClient = createPrismaClient(TEST_URL);

const TABLES = [
  "request_comments", "request_events", "service_requests", "request_categories",
  "onboarding_tasks", "onboarding_instances", "template_tasks", "onboarding_templates",
  "users", "departments",
];

/** Empties every application table. Call in beforeEach of DB tests. */
export async function resetDb() {
  await db.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  // Not column-owned, so TRUNCATE ... RESTART IDENTITY does not reset it.
  await db.$executeRawUnsafe(`ALTER SEQUENCE service_request_ref_seq RESTART WITH 1001`);
}

let n = 0;
export async function makeDepartment(name = `Dept ${++n}`) {
  return db.department.create({ data: { code: `D${++n}`, name } });
}

/** The id of a lookup row, by code (roles, statuses) or shortcode (countries). Ids differ between databases, so tests never write one down. */
export const roleId = async (code: RoleCode) => (await db.role.findUniqueOrThrow({ where: { code } })).id;
export const statusId = async (code: StatusCode) => (await db.userStatus.findUniqueOrThrow({ where: { code } })).id;
export const countryId = async (shortcode: string) => (await db.country.findUniqueOrThrow({ where: { shortcode } })).id;

type UserOverrides = Partial<Omit<Prisma.UserUncheckedCreateInput, "roleId" | "countryId" | "statusId">> & {
  /** Role code (default EMPLOYEE), country shortcode (default BD) and status code (default ACTIVE). */
  role?: RoleCode;
  country?: string;
  status?: StatusCode;
};

export async function makeUser(departmentId: string, overrides: UserOverrides = {}) {
  const i = ++n;
  const { role = "EMPLOYEE", country = "BD", status = "ACTIVE", ...rest } = overrides;
  return db.user.create({
    data: {
      employeeCode: `E${i}`,
      fullName: `User ${i}`,
      email: `user${i}@example.com`,
      passwordHash: "x",
      roleId: await roleId(role),
      countryId: await countryId(country),
      statusId: await statusId(status),
      departmentId,
      jobTitle: "Engineer",
      joiningDate: new Date("2024-01-01"),
      ...rest,
    },
  });
}
