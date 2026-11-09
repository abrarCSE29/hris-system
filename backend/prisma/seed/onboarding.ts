import { randomUUID } from "node:crypto";
import type { OnboardingTaskStatus, OwnerType, PrismaClient } from "../../src/generated/prisma/client";
import { addDays, todayInDhaka, toIsoDate } from "../../src/services/onboarding-logic";
import type { seedBase } from "./base";

type Base = Awaited<ReturnType<typeof seedBase>>;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TemplateTaskDef {
  key: string;
  title: string;
  description: string;
  owner: "MANAGER" | string; // "MANAGER" or a department code
  label: string;
  offset: number;
  dependsOn?: string;
}

const STANDARD: TemplateTaskDef[] = [
  { key: "accounts", title: "Create user accounts", description: "Email, chat and single sign-on accounts for the new joiner.", owner: "ITOPS", label: "Day 1", offset: 0 },
  { key: "laptop", title: "Provision laptop", description: "Image and hand over a laptop with the standard software.", owner: "ITOPS", label: "Week 1", offset: 4, dependsOn: "accounts" },
  { key: "software", title: "Grant software access", description: "Role-based access to the tools the team uses.", owner: "ITOPS", label: "Week 1", offset: 4, dependsOn: "laptop" },
  { key: "contract", title: "Sign contract and collect documents", description: "Signed employment contract, ID and tax forms.", owner: "PEOPLE", label: "Day 1", offset: 0 },
  { key: "payroll", title: "Set up payroll and benefits", description: "Register the employee for payroll, insurance and benefits.", owner: "PEOPLE", label: "Week 1", offset: 4, dependsOn: "contract" },
  { key: "desk", title: "Prepare desk and access card", description: "Desk, chair and building access card ready for day one.", owner: "OPS", label: "Day 1", offset: 0 },
  { key: "welcome", title: "Welcome meeting with manager", description: "Introduce the team, role expectations and first-month goals.", owner: "MANAGER", label: "Day 1", offset: 0 },
  { key: "buddy", title: "Assign an onboarding buddy", description: "Pick a colleague to answer day-to-day questions.", owner: "MANAGER", label: "Week 1", offset: 4 },
  { key: "training", title: "Complete compliance and security training", description: "Mandatory data protection and security awareness course.", owner: "LEGAL", label: "Week 2", offset: 9, dependsOn: "accounts" },
  { key: "checkin", title: "30-day check-in", description: "Review progress and gather feedback from the new joiner.", owner: "MANAGER", label: "Day 30", offset: 29, dependsOn: "welcome" },
];

const ENGINEERING: TemplateTaskDef[] = [
  ...STANDARD,
  { key: "repo", title: "Grant repository access", description: "Read/write access to the team's code repositories.", owner: "ITOPS", label: "Week 1", offset: 4, dependsOn: "software" },
  { key: "devenv", title: "Set up development environment", description: "Local environment running and first build passing.", owner: "ENG", label: "Week 2", offset: 9, dependsOn: "repo" },
];

async function createTemplate(db: PrismaClient, base: Base, name: string, description: string, defs: TemplateTaskDef[]) {
  const idByKey = new Map(defs.map((d) => [d.key, randomUUID()]));
  const template = await db.onboardingTemplate.create({ data: { name, description, createdById: base.personas.hrAdmin } });
  await db.templateTask.createMany({
    data: defs.map((d, i) => ({
      id: idByKey.get(d.key)!,
      templateId: template.id,
      title: d.title,
      description: d.description,
      ownerType: (d.owner === "MANAGER" ? "MANAGER" : "DEPARTMENT") as OwnerType,
      ownerDepartmentId: d.owner === "MANAGER" ? null : base.departmentIds[d.owner],
      offsetDays: d.offset,
      deadlineLabel: d.label,
      dependsOnId: d.dependsOn ? idByKey.get(d.dependsOn)! : null,
      sortOrder: i + 1,
    })),
  });
  return template;
}

/**
 * Seed part 3 (spec §7): two templates and the 7 designated new hires with checklists in mixed states.
 * Progress is generated from each hire's age so it is realistic and internally consistent
 * (nothing is completed while the task it depends on is not, nothing in progress is blocked).
 */
export async function seedOnboarding(db: PrismaClient, base: Base) {
  const rand = mulberry32(4242);
  const today = todayInDhaka();
  const now = Date.now();

  const standard = await createTemplate(db, base, "Standard Onboarding", "Checklist for every new joiner.", STANDARD);
  const engineering = await createTemplate(db, base, "Engineering Onboarding", "Standard checklist plus repository access and development environment setup.", ENGINEERING);

  const hires = await db.user.findMany({ where: { id: { in: base.newHireIds } }, include: { department: true }, orderBy: { joiningDate: "asc" } });
  let instanceCount = 0;

  for (const hire of hires) {
    const template = hire.department.code === "ENG" ? engineering : standard;
    const defs = hire.department.code === "ENG" ? ENGINEERING : STANDARD;
    const tplTasks = await db.templateTask.findMany({ where: { templateId: template.id }, orderBy: { sortOrder: "asc" } });
    const startDate = toIsoDate(hire.joiningDate);

    const instance = await db.onboardingInstance.create({
      data: { employeeId: hire.id, templateId: template.id, startDate: new Date(`${startDate}T00:00:00Z`) },
    });

    // Decide each task's state in order, so a dependency is always decided before what depends on it.
    const newIdByTplId = new Map(tplTasks.map((t) => [t.id, randomUUID()]));
    const status = new Map<string, OnboardingTaskStatus>();
    const completedAt = new Map<string, number>();
    const lastIndex = tplTasks.length - 1;

    const owners = async (t: (typeof tplTasks)[number]) => {
      if (t.ownerType === "MANAGER") return hire.managerId!;
      const members = await db.user.findMany({ where: { departmentId: t.ownerDepartmentId!, status: { code: { not: "ON_NOTICE" } } }, select: { id: true }, orderBy: { employeeCode: "asc" } });
      return members[Math.floor(rand() * members.length)].id;
    };

    const rows = [];
    for (let i = 0; i < tplTasks.length; i++) {
      const t = tplTasks[i];
      const id = newIdByTplId.get(t.id)!;
      const dueDate = addDays(startDate, t.offsetDays);
      const depDone = !t.dependsOnId || status.get(newIdByTplId.get(t.dependsOnId)!) === "COMPLETED";

      let s: OnboardingTaskStatus = "NOT_STARTED";
      if (depDone && i !== lastIndex) {
        const r = rand();
        if (dueDate < addDays(today, -2)) s = r < 0.7 ? "COMPLETED" : r < 0.85 ? "IN_PROGRESS" : "NOT_STARTED"; // clearly past due
        else if (dueDate <= today) s = r < 0.35 ? "COMPLETED" : r < 0.7 ? "IN_PROGRESS" : "NOT_STARTED";
        else s = r < 0.15 ? "IN_PROGRESS" : "NOT_STARTED"; // future
      }
      // The last task is always left open, so a checklist is never accidentally finished.
      status.set(id, s);

      let done: { completedAt: Date; completedById: string } | null = null;
      if (s === "COMPLETED") {
        const depTime = t.dependsOnId ? (completedAt.get(newIdByTplId.get(t.dependsOnId)!) ?? 0) : 0;
        const natural = new Date(`${addDays(startDate, Math.max(0, t.offsetDays - Math.floor(rand() * 3)))}T10:00:00Z`).getTime();
        const at = Math.min(Math.max(natural, depTime + 3_600_000), now - 3_600_000);
        completedAt.set(id, at);
        done = { completedAt: new Date(at), completedById: await owners(t) };
      }
      rows.push({
        id,
        instanceId: instance.id,
        title: t.title,
        description: t.description,
        ownerType: t.ownerType,
        ownerDepartmentId: t.ownerDepartmentId,
        assigneeId: t.ownerType === "MANAGER" ? hire.managerId : null,
        dueDate: new Date(`${dueDate}T00:00:00Z`),
        status: s,
        dependsOnId: t.dependsOnId ? newIdByTplId.get(t.dependsOnId)! : null,
        completedAt: done?.completedAt ?? null,
        completedById: done?.completedById ?? null,
        sortOrder: t.sortOrder,
      });
    }
    await db.onboardingTask.createMany({ data: rows });
    instanceCount++;
    void defs;
  }
  return { templateCount: 2, instanceCount };
}
