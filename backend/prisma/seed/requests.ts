import type { Prisma, PrismaClient, RequestPriority, RequestStatus } from "../../src/generated/prisma/client";
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

type CategoryCode = "IT_EQUIPMENT" | "SOFTWARE_ACCESS" | "HR_QUERY" | "FACILITIES" | "OTHER";

// One distinct title + description per request: 9 + 8 + 7 + 6 + 5 = 35.
const TEXT: Record<CategoryCode, [string, string][]> = {
  IT_EQUIPMENT: [
    ["New laptop for starter", "I join this week and have not received a laptop yet. Standard developer spec please."],
    ["Laptop battery drains in an hour", "My laptop shuts down after about an hour unplugged. It is three years old."],
    ["External monitor request", "Requesting a 27-inch external monitor for my home office setup."],
    ["Replacement keyboard", "Several keys on my keyboard have stopped responding, including the space bar."],
    ["Headset for client calls", "I take daily client calls and need a noise-cancelling headset."],
    ["Docking station not detected", "The USB-C docking station in the office is not detected by my laptop since the last update."],
    ["Mouse and webcam for new joiner", "Please provide a mouse and an external webcam for my first week."],
    ["Phone charger and cable", "I need a replacement company phone charger; the cable is frayed."],
    ["Laptop screen flickering", "The screen flickers when I move the lid. Happens several times a day."],
  ],
  SOFTWARE_ACCESS: [
    ["Access to source code repository", "Please grant me access to the main repository so I can start on my first ticket."],
    ["Figma editor licence", "I need an editor seat in Figma for the upcoming brand refresh."],
    ["Password manager invite", "I have not received my invitation to the team password manager."],
    ["Access to finance reporting tool", "Please give me read access to the monthly finance reports dashboard."],
    ["VPN setup", "I cannot connect to the VPN from my laptop. Need an account configured."],
    ["Project tracker account", "Please create an account for me in the project tracker and add me to my team's board."],
    ["Shared mailbox access", "I need access to the support shared mailbox to cover for a colleague."],
    ["Video conferencing licence", "I need a licensed account for hosting external meetings longer than 40 minutes."],
  ],
  HR_QUERY: [
    ["Remaining annual leave balance", "Could you confirm how many days of annual leave I have left this year?"],
    ["Payslip for last month missing", "I cannot see last month's payslip in the portal. Can it be re-issued?"],
    ["Update my emergency contact", "I would like to change my emergency contact details on file."],
    ["Health insurance coverage question", "Does the company health plan cover my spouse? Looking for the policy document."],
    ["Probation review date", "When is my probation review scheduled and who will conduct it?"],
    ["Employment letter for visa application", "I need an employment confirmation letter for a visa application."],
    ["Public holiday calendar", "Where can I find the list of public holidays for my country this year?"],
  ],
  FACILITIES: [
    ["Desk and chair for new starter", "A new team member joins on Monday and needs a desk and an ergonomic chair."],
    ["Air conditioning too cold", "The air conditioning on our floor is set too low and several of us are uncomfortable."],
    ["Broken meeting room projector", "The projector in the second-floor meeting room does not power on."],
    ["Access card not working", "My office access card stopped working at the main entrance this morning."],
    ["Parking space request", "Requesting a parking space; I now commute by car."],
    ["Office kitchen supplies", "We have run out of coffee and tea in the fourth-floor kitchen."],
  ],
  OTHER: [
    ["Request to attend an external conference", "I would like to attend a cloud conference next quarter. Whom do I ask for approval?"],
    ["Team offsite planning", "We are planning a team offsite and need guidance on budget and booking."],
    ["Suggestion for a wellbeing programme", "I would like to suggest a monthly wellbeing session for the whole company."],
    ["Lost property in the office", "I left a grey jacket in the third-floor meeting room last week."],
    ["Mailing address change for courier", "Please update the courier delivery address for the Cyprus office."],
  ],
};

const CATEGORY_ORDER: CategoryCode[] = ["IT_EQUIPMENT", "SOFTWARE_ACCESS", "HR_QUERY", "FACILITIES", "OTHER"];
const STATUS_COUNTS: [RequestStatus, number][] = [["SUBMITTED", 7], ["ASSIGNED", 7], ["IN_PROGRESS", 8], ["RESOLVED", 6], ["CLOSED", 7]];
const PRIORITY_COUNTS: [RequestPriority, number][] = [["LOW", 8], ["MEDIUM", 15], ["HIGH", 8], ["URGENT", 4]];
const COMMENTS = [
  "Could you share a few more details?",
  "Thanks, looking into this now.",
  "Update: waiting on a quote from the supplier.",
  "This is blocking my first week. Is there an ETA?",
  "Should be sorted by the end of the day.",
  "Done on my side, please confirm it works for you.",
  "Confirmed, thank you!",
  "I have escalated this to the team lead.",
];
const OPEN: RequestStatus[] = ["SUBMITTED", "ASSIGNED", "IN_PROGRESS"];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface Spec {
  category: CategoryCode;
  title: string;
  description: string;
  status: RequestStatus;
  priority: RequestPriority;
  requesterId: string;
  assigneeId: string | null;
  createdAt: number;
}

/** Seed part 2 (spec §7): 35 requests with consistent history and some comment threads. */
export async function seedRequests(db: PrismaClient, base: Base) {
  const rand = mulberry32(777);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const shuffle = <T>(xs: T[]) => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };
  const expand = <T>(pairs: [T, number][]) => pairs.flatMap(([v, n]) => Array<T>(n).fill(v));

  const categories = await db.requestCategory.findMany();
  const deptOf = new Map(categories.map((c) => [c.code, c.handlingDepartmentId]));
  const catId = new Map(categories.map((c) => [c.code, c.id]));
  const depts = await db.department.findMany();
  const headOf = new Map(depts.map((d) => [d.id, d.headId!]));
  const users = await db.user.findMany();
  const byId = new Map(users.map((u) => [u.id, u]));
  const requesters = users.filter((u) => u.status !== "ON_NOTICE");
  const workers = (deptId: string) => users.filter((u) => u.departmentId === deptId && u.status !== "ON_NOTICE" && u.role === "EMPLOYEE");

  // Lists with exact counts, shuffled independently, then paired up.
  const statuses = shuffle(expand(STATUS_COUNTS));
  const priorities = shuffle(expand(PRIORITY_COUNTS));
  const texts = CATEGORY_ORDER.flatMap((code) => TEXT[code].map(([title, description]) => ({ category: code, title, description })));
  shuffle(texts);

  const newHires = base.newHireIds;
  let hireCursor = 0;
  let personaAssigned = 0;
  const specs: Spec[] = texts.map((t, i) => {
    const status = statuses[i];
    const isIt = t.category === "IT_EQUIPMENT" || t.category === "SOFTWARE_ACCESS";

    // New hires raise several IT requests that are still open (feeds the cross-module insight).
    let requesterId: string;
    if (isIt && OPEN.includes(status) && hireCursor < 5) requesterId = newHires[hireCursor++];
    else if (!isIt && i % 6 === 0) requesterId = newHires[i % newHires.length];
    else requesterId = pick(requesters).id;

    // Assignee: from the handling department; the IT persona gets the first few IT requests that have one.
    let assigneeId: string | null = null;
    if (status !== "SUBMITTED") {
      const pool = workers(deptOf.get(t.category)!);
      if (isIt && personaAssigned < 5 && requesterId !== base.personas.itSupport) {
        assigneeId = base.personas.itSupport;
        personaAssigned++;
      } else {
        do assigneeId = pick(pool).id; while (assigneeId === requesterId && pool.length > 1);
      }
    }

    // Older requests are further along. Keep at least two days of room for the later events.
    const age = status === "CLOSED" ? int(25, 60) : status === "RESOLVED" ? int(14, 40) : status === "IN_PROGRESS" ? int(6, 30) : status === "ASSIGNED" ? int(3, 15) : int(2, 10);
    return { ...t, status, priority: priorities[i], requesterId, assigneeId, createdAt: Date.now() - age * DAY - int(0, 20) * HOUR };
  });
  specs.sort((a, b) => a.createdAt - b.createdAt); // SR-1001 is the oldest

  const createdIds: { id: string; spec: Spec; lastEvent: number }[] = [];
  for (const spec of specs) {
    const requester = byId.get(spec.requesterId)!;
    const deptId = deptOf.get(spec.category)!;
    const head = headOf.get(deptId)!;
    // The head assigns, unless the head is the requester (then HR does).
    const assigner = head !== spec.requesterId ? head : base.personas.hrAdmin;

    // Build the history to match the final status.
    const chain: RequestStatus[] = ["SUBMITTED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];
    const steps = chain.slice(0, chain.indexOf(spec.status) + 1);
    let t = spec.createdAt;
    const events: Prisma.RequestEventCreateManyRequestInput[] = steps.map((to, idx) => {
      if (idx > 0) t += int(1, 8) * HOUR;
      const from = idx === 0 ? null : steps[idx - 1];
      const actorId = to === "SUBMITTED" ? requester.id : to === "ASSIGNED" ? assigner : to === "CLOSED" ? (idx % 2 ? requester.id : base.personas.hrAdmin) : spec.assigneeId!;
      return {
        fromStatus: from,
        toStatus: to,
        actorId,
        assigneeId: to === "ASSIGNED" ? spec.assigneeId : null,
        note: to === "RESOLVED" ? "Resolved and confirmed with the requester." : null,
        createdAt: new Date(t),
      };
    });

    const created = await db.serviceRequest.create({
      data: {
        requesterId: spec.requesterId,
        categoryId: catId.get(spec.category)!,
        handlingDepartmentId: deptId,
        assigneeId: spec.assigneeId,
        title: spec.title,
        description: spec.description,
        priority: spec.priority,
        status: spec.status,
        createdAt: new Date(spec.createdAt),
        updatedAt: new Date(t),
        events: { createMany: { data: events } },
      },
    });
    createdIds.push({ id: created.id, spec, lastEvent: t });
  }

  // Comment threads (2–4 comments) on 7 requests that have people involved.
  const threaded = createdIds.filter((c) => c.spec.status !== "SUBMITTED").slice(0, 7);
  for (const { id, spec, lastEvent } of threaded) {
    const requester = byId.get(spec.requesterId)!;
    const participants = [spec.requesterId, spec.assigneeId!, ...(requester.managerId ? [requester.managerId] : [])];
    const count = int(2, 4);
    let t = spec.createdAt + 2 * HOUR;
    for (let i = 0; i < count; i++) {
      t = Math.min(t + int(1, 10) * HOUR, lastEvent + HOUR);
      await db.requestComment.create({
        data: { requestId: id, authorId: participants[i % participants.length], body: COMMENTS[(i + threaded.length + specs.indexOf(spec)) % COMMENTS.length], createdAt: new Date(t) },
      });
    }
  }
  return { requestCount: createdIds.length };
}
