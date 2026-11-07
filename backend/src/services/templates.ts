import { randomUUID } from "node:crypto";
import { z } from "zod";
import { OwnerType, Prisma } from "@/generated/prisma/client";
import type { AuthUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { findDependencyProblems, offsetForLabel } from "./onboarding-logic";

// ── input ────────────────────────────────────────────────────────────────────

const templateTask = z
  .object({
    /** Client-chosen identifier, only used to express dependencies inside this one request. */
    key: z.string().trim().min(1).max(50),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).default(""),
    ownerType: z.enum(OwnerType),
    ownerDepartmentId: z.uuid().optional(),
    offsetDays: z.number().int().min(0).max(365),
    deadlineLabel: z.string().trim().min(1).max(40),
    dependsOnKey: z.string().trim().min(1).max(50).optional(),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.ownerType === "DEPARTMENT" && !t.ownerDepartmentId) {
      ctx.addIssue({ code: "custom", path: ["ownerDepartmentId"], message: "A department is required for department-owned tasks" });
    }
    if (t.ownerType === "MANAGER" && t.ownerDepartmentId) {
      ctx.addIssue({ code: "custom", path: ["ownerDepartmentId"], message: "Manager-owned tasks must not have a department" });
    }
    // Standard labels ("Day 1", "Week 1", "Day 30") must agree with the offset; custom labels are free.
    const expected = offsetForLabel(t.deadlineLabel);
    if (expected !== null && expected !== t.offsetDays) {
      ctx.addIssue({ code: "custom", path: ["offsetDays"], message: `"${t.deadlineLabel}" means an offset of ${expected} days` });
    }
  });

export const createTemplateBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(""),
    tasks: z.array(templateTask).min(1).max(60),
  })
  .strict();

export type CreateTemplateInput = z.infer<typeof createTemplateBody>;

// ── output ───────────────────────────────────────────────────────────────────

const taskInclude = { ownerDepartment: { select: { id: true, code: true, name: true } } } satisfies Prisma.TemplateTaskInclude;

const templateInclude = {
  createdBy: { select: { id: true, fullName: true } },
  tasks: { include: taskInclude, orderBy: { sortOrder: "asc" } },
} satisfies Prisma.OnboardingTemplateInclude;

type TemplateRow = Prisma.OnboardingTemplateGetPayload<{ include: typeof templateInclude }>;

function serializeTemplate(t: TemplateRow) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    createdAt: t.createdAt.toISOString(),
    createdBy: t.createdBy,
    tasks: t.tasks.map((k) => ({
      id: k.id,
      title: k.title,
      description: k.description,
      ownerType: k.ownerType,
      ownerDepartment: k.ownerDepartment,
      offsetDays: k.offsetDays,
      deadlineLabel: k.deadlineLabel,
      dependsOnId: k.dependsOnId,
      sortOrder: k.sortOrder,
    })),
  };
}

const notFound = () => new ApiError("NOT_FOUND", "Template not found");

// ── operations ───────────────────────────────────────────────────────────────

/** Everything that must hold before a template is saved: dependency graph, departments exist. Throws 422. */
async function validateTemplateInput(input: CreateTemplateInput) {
  // Dependencies: unique keys, no unknown keys, no cycles.
  const problems = findDependencyProblems(input.tasks);
  if (problems.length > 0) {
    throw new ApiError(
      "VALIDATION_FAILED",
      problems[0].message,
      problems.map((p) => ({ path: `tasks.${p.index}.${p.field}`, message: p.message })),
    );
  }

  const deptIds = [...new Set(input.tasks.map((t) => t.ownerDepartmentId).filter((x): x is string => !!x))];
  if (deptIds.length > 0) {
    const found = await prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true } });
    const missing = new Set(deptIds);
    found.forEach((d) => missing.delete(d.id));
    if (missing.size > 0) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Unknown department",
        input.tasks.flatMap((t, i) => (t.ownerDepartmentId && missing.has(t.ownerDepartmentId) ? [{ path: `tasks.${i}.ownerDepartmentId`, message: "Department not found" }] : [])),
      );
    }
  }
}

/** Task rows for a template. Ids are generated here so each task's dependency can point at another's id in one insert. */
function taskRows(templateId: string, input: CreateTemplateInput): Prisma.TemplateTaskCreateManyInput[] {
  const idByKey = new Map(input.tasks.map((t) => [t.key, randomUUID()]));
  return input.tasks.map((t, i) => ({
    id: idByKey.get(t.key)!,
    templateId,
    title: t.title,
    description: t.description,
    ownerType: t.ownerType,
    ownerDepartmentId: t.ownerDepartmentId ?? null,
    offsetDays: t.offsetDays,
    deadlineLabel: t.deadlineLabel,
    dependsOnId: t.dependsOnKey ? idByKey.get(t.dependsOnKey)! : null,
    sortOrder: i + 1,
  }));
}

const duplicateName = () => new ApiError("CONFLICT", "A template with this name already exists");
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function createTemplate(actor: AuthUser, input: CreateTemplateInput) {
  await validateTemplateInput(input);
  if (await prisma.onboardingTemplate.findUnique({ where: { name: input.name }, select: { id: true } })) throw duplicateName();

  try {
    const id = await prisma.$transaction(async (tx) => {
      const template = await tx.onboardingTemplate.create({
        data: { name: input.name, description: input.description, createdById: actor.id },
      });
      await tx.templateTask.createMany({ data: taskRows(template.id, input) });
      return template.id;
    });
    return await getTemplate(id);
  } catch (e) {
    // Two creates with the same name racing past the check above.
    if (isUniqueViolation(e)) throw duplicateName();
    throw e;
  }
}

/**
 * Replaces a template's name, description and tasks. Checklists already assigned are copies, so they
 * are not touched: edits only affect assignments made afterwards. Either everything is saved or nothing.
 */
export async function updateTemplate(id: string, input: CreateTemplateInput) {
  if (!z.uuid().safeParse(id).success) throw notFound();
  if (!(await prisma.onboardingTemplate.findUnique({ where: { id }, select: { id: true } }))) throw notFound();

  await validateTemplateInput(input);
  if (await prisma.onboardingTemplate.findFirst({ where: { name: input.name, id: { not: id } }, select: { id: true } })) throw duplicateName();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.onboardingTemplate.update({ where: { id }, data: { name: input.name, description: input.description } });
      // One statement each, so tasks that reference each other are checked together.
      await tx.templateTask.deleteMany({ where: { templateId: id } });
      await tx.templateTask.createMany({ data: taskRows(id, input) });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw duplicateName();
    throw e;
  }
  return getTemplate(id);
}

export async function listTemplates() {
  const rows = await prisma.onboardingTemplate.findMany({
    include: { createdBy: { select: { id: true, fullName: true } }, _count: { select: { tasks: true } } },
    orderBy: [{ name: "asc" }],
  });
  return {
    data: rows.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
      createdBy: t.createdBy,
      taskCount: t._count.tasks,
    })),
  };
}

export async function getTemplate(id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound();
  const row = await prisma.onboardingTemplate.findUnique({ where: { id }, include: templateInclude });
  if (!row) throw notFound();
  return serializeTemplate(row);
}
