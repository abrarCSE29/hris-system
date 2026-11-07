import { createPrismaClient } from "@/lib/create-prisma";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

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

export async function makeUser(departmentId: string, overrides: Partial<Prisma.UserUncheckedCreateInput> = {}) {
  const i = ++n;
  return db.user.create({
    data: {
      employeeCode: `E${i}`,
      fullName: `User ${i}`,
      email: `user${i}@example.com`,
      passwordHash: "x",
      role: "EMPLOYEE",
      country: "BANGLADESH",
      departmentId,
      jobTitle: "Engineer",
      joiningDate: new Date("2024-01-01"),
      ...overrides,
    },
  });
}
