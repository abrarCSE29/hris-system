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
type DeptCode = "ENG" | "ITOPS" | "PEOPLE" | "FIN" | "MKT" | "LEGAL" | "OPS";

/**
 * One distinct title + description per request: 16 + 18 + 16 + 13 + 17 = 80. A request goes to its category's department
 * unless the text names the department that really owns it (a repository goes to Engineering, a contract to Legal), the same
 * way an employee can pick another handling department on the form. That gives every Manager request work to look at.
 */
type Text = [title: string, description: string, department?: DeptCode];
const TEXT: Record<CategoryCode, Text[]> = {
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
    ["Laptop upgrade for design work", "My laptop struggles with large design files. Requesting a machine with a dedicated graphics card."],
    ["Second charger for the office", "I travel between two sites and need a second laptop charger so I do not carry one every day."],
    ["Wireless presenter remote", "I run the weekly demo and need a wireless presenter remote."],
    ["Spare laptop for a contractor", "A contractor joins next month and needs a loaner laptop for six weeks."],
    ["Printer on floor three offline", "The shared printer on floor three shows as offline for everyone since Monday."],
    ["Dual monitor setup for a new hire", "Our new analyst starts Monday and needs two monitors and a docking station at their desk."],
    ["Laptop bag and accessories", "I need a laptop bag and a USB hub for client visits."],
  ],
  SOFTWARE_ACCESS: [
    ["Access to source code repository", "Please grant me access to the main repository so I can start on my first ticket.", "ENG"],
    ["Figma editor licence", "I need an editor seat in Figma for the upcoming brand refresh.", "MKT"],
    ["Password manager invite", "I have not received my invitation to the team password manager."],
    ["Access to finance reporting tool", "Please give me read access to the monthly finance reports dashboard.", "FIN"],
    ["VPN setup", "I cannot connect to the VPN from my laptop. Need an account configured."],
    ["Project tracker account", "Please create an account for me in the project tracker and add me to my team's board."],
    ["Shared mailbox access", "I need access to the support shared mailbox to cover for a colleague."],
    ["Video conferencing licence", "I need a licensed account for hosting external meetings longer than 40 minutes."],
    ["CI pipeline failing for my branch", "The build pipeline fails at the lint step on every push to my branch. It looks like a configuration issue.", "ENG"],
    ["Analytics dashboard access", "I need viewer access to the web analytics dashboard to prepare the campaign report.", "MKT"],
    ["Expense tool approver rights", "Please make me an approver in the expense tool for my team's claims.", "FIN"],
    ["Cloud console read-only access", "I need read-only access to the cloud console to check the cost of our test environment."],
    ["Two-factor reset after phone change", "I got a new phone and can no longer generate sign-in codes. Please reset my two-factor setup."],
    ["Staging environment is down", "The shared staging environment returns 502 errors since this morning, so we cannot test the release.", "ENG"],
    ["Production log access for support", "The support team needs read-only access to production logs to trace customer reports.", "ENG"],
    ["Sandbox API key", "Please issue a sandbox API key so the partner integration can be tested end to end.", "ENG"],
    ["Social media account access", "I need posting access to the company social media accounts for the product launch.", "MKT"],
    ["Antivirus alert on my laptop", "The endpoint protection shows a quarantine alert after I opened a supplier file. Is it safe to restore?"],
  ],
  HR_QUERY: [
    ["Remaining annual leave balance", "Could you confirm how many days of annual leave I have left this year?"],
    ["Payslip for last month missing", "I cannot see last month's payslip in the portal. Can it be re-issued?"],
    ["Update my emergency contact", "I would like to change my emergency contact details on file."],
    ["Health insurance coverage question", "Does the company health plan cover my spouse? Looking for the policy document."],
    ["Probation review date", "When is my probation review scheduled and who will conduct it?"],
    ["Employment letter for visa application", "I need an employment confirmation letter for a visa application."],
    ["Public holiday calendar", "Where can I find the list of public holidays for my country this year?"],
    ["Parental leave policy", "Could you point me to the parental leave policy and explain how to apply?"],
    ["Salary certificate for a bank loan", "My bank asks for a salary certificate for a loan application. How long does it take?"],
    ["Copy of my employment contract", "I cannot find my signed employment contract and need a copy for a mortgage application.", "LEGAL"],
    ["Work-from-home policy", "How many days a week can I work from home, and does it differ by country?"],
    ["Training budget per employee", "Is there a yearly training budget and how do I claim it?"],
    ["Expense reimbursement status", "I submitted a travel expense claim three weeks ago and it still shows as pending. Who can check?", "FIN"],
    ["Travel advance request", "I travel to the regional office next month. How do I request a travel advance?", "FIN"],
    ["Onboarding schedule for next month's starters", "Could People & Culture share the induction schedule for the four starters joining next month?"],
    ["Referral bonus policy", "I referred a candidate who was hired. Where can I read the referral bonus rules?"],
  ],
  FACILITIES: [
    ["Desk and chair for new starter", "A new team member joins on Monday and needs a desk and an ergonomic chair."],
    ["Air conditioning too cold", "The air conditioning on our floor is set too low and several of us are uncomfortable."],
    ["Broken meeting room projector", "The projector in the second-floor meeting room does not power on."],
    ["Access card not working", "My office access card stopped working at the main entrance this morning."],
    ["Parking space request", "Requesting a parking space; I now commute by car."],
    ["Office kitchen supplies", "We have run out of coffee and tea in the fourth-floor kitchen."],
    ["Broken blinds near my desk", "The blinds next to my desk will not close and the afternoon glare makes the screen unreadable."],
    ["Standing desk request", "I would like to try a standing desk for back pain. Is there a process?"],
    ["Fire drill schedule", "When is the next fire drill, and where is the assembly point for the third floor?"],
    ["Visitor badges for a client workshop", "We host a client workshop on Thursday and need twelve visitor badges and a sign-in sheet."],
    ["Noise from construction next door", "Drilling next door makes calls impossible in the morning. Can we move the team to the quiet floor?"],
    ["Meeting room booking system not working", "The room booking screen shows every room as free, so we keep walking into occupied rooms."],
    ["Courier collection for office supplies", "A pallet of office supplies is waiting at the courier depot and needs collecting."],
  ],
  OTHER: [
    ["Request to attend an external conference", "I would like to attend a cloud conference next quarter. Whom do I ask for approval?"],
    ["Team offsite planning", "We are planning a team offsite and need guidance on budget and booking.", "OPS"],
    ["Suggestion for a wellbeing programme", "I would like to suggest a monthly wellbeing session for the whole company."],
    ["Lost property in the office", "I left a grey jacket in the third-floor meeting room last week."],
    ["Mailing address change for courier", "Please update the courier delivery address for the Cyprus office."],
    ["Supplier contract review", "Please review the draft contract from our new cloud supplier before we sign it.", "LEGAL"],
    ["Budget code for a new project", "Which cost centre should I use for the new customer onboarding project?", "FIN"],
    ["Data protection question on a campaign", "Can we email last year's event attendees about the new programme under our consent rules?", "LEGAL"],
    ["Engineering buddy roster", "Could we get a buddy roster for the next engineering intake so every starter has a named contact?", "ENG"],
    ["Brand guidelines for a partner event", "We co-host an event with a partner. Which logo and colour rules apply to the joint banner?", "MKT"],
    ["Technical review of a vendor integration", "Could Engineering review the vendor's integration proposal before we commit to the contract?", "ENG"],
    ["Press kit and logo files", "A journalist asked for our press kit. Where are the approved logo files and the company fact sheet?", "MKT"],
    ["Newsletter send request", "Please schedule the monthly customer newsletter for Thursday morning.", "MKT"],
    ["Corporate card limit increase", "My corporate card limit is too low for the conference bookings next month. Can it be raised?", "FIN"],
    ["Invoice query from a supplier", "A supplier says invoice 4471 is overdue but we have no record of receiving it. Can Finance check?", "FIN"],
    ["Trademark question for a product name", "We want to name the new product 'Beacon'. Has anyone checked whether the name is free to use?", "LEGAL"],
    ["Review of a customer data agreement", "A customer sent a data processing agreement. Please review it before we sign.", "LEGAL"],
  ],
};

const CATEGORY_ORDER: CategoryCode[] = ["IT_EQUIPMENT", "SOFTWARE_ACCESS", "HR_QUERY", "FACILITIES", "OTHER"];
const STATUS_COUNTS: [RequestStatus, number][] = [["SUBMITTED", 10], ["ASSIGNED", 12], ["IN_PROGRESS", 14], ["RESOLVED", 16], ["CLOSED", 28]];
const PRIORITY_COUNTS: [RequestPriority, number][] = [["LOW", 18], ["MEDIUM", 34], ["HIGH", 19], ["URGENT", 9]];
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

/** Every department gets a request that is finished, one being worked on, and one resolved recently (two for Engineering, the demo Manager's). */
const ALL_DEPARTMENTS: DeptCode[] = ["ENG", "ITOPS", "PEOPLE", "FIN", "MKT", "LEGAL", "OPS"];

interface Spec {
  category: CategoryCode;
  department: DeptCode;
  title: string;
  description: string;
  status: RequestStatus;
  priority: RequestPriority;
  requesterId: string;
  assigneeId: string | null;
  createdAt: number;
  /** Hours between one step and the next (assign, start, resolve, close), as many as the status has reached. */
  gapsHours: number[];
}

/** Seed part 2 (spec §7): 80 requests over the last 90 days, with consistent history and some comment threads. */
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
  const catId = new Map(categories.map((c) => [c.code, c.id]));
  const depts = await db.department.findMany();
  const deptIdOf = new Map(depts.map((d) => [d.code as DeptCode, d.id]));
  const deptCodeOf = new Map(depts.map((d) => [d.id, d.code as DeptCode]));
  const categoryDept = new Map(categories.map((c) => [c.code as CategoryCode, deptCodeOf.get(c.handlingDepartmentId)!]));
  const headOf = new Map(depts.map((d) => [d.id, d.headId!]));
  const users = await db.user.findMany({ include: { role: { select: { code: true } }, status: { select: { code: true } } } });
  const byId = new Map(users.map((u) => [u.id, u]));
  const requesters = users.filter((u) => u.status.code !== "ON_NOTICE");
  const workers = (deptId: string) => users.filter((u) => u.departmentId === deptId && u.status.code !== "ON_NOTICE" && u.role.code === "EMPLOYEE");

  // Lists with exact counts, shuffled independently, then paired up.
  const statuses = shuffle(expand(STATUS_COUNTS));
  const priorities = shuffle(expand(PRIORITY_COUNTS));
  const texts = CATEGORY_ORDER.flatMap((code) =>
    TEXT[code].map(([title, description, department]) => ({ category: code, title, description, department: department ?? categoryDept.get(code)!, rerouted: department !== undefined })),
  );
  shuffle(texts);

  // Each department is guaranteed a finished request, one in hand and one resolved recently, by swapping statuses with
  // requests not yet decided (so the overall counts do not change).
  const fixed = new Set<number>();
  const recent = new Set<number>(); // resolved within the last few weeks, so it shows in the 30-day period for sure
  const ensure = (i: number, allowed: RequestStatus[]) => {
    if (!allowed.includes(statuses[i])) {
      const j = statuses.findIndex((st, k) => !fixed.has(k) && k !== i && allowed.includes(st));
      [statuses[i], statuses[j]] = [statuses[j], statuses[i]];
    }
    fixed.add(i);
  };
  for (const dept of ALL_DEPARTMENTS) {
    const mine = texts.flatMap((t, i) => (t.department === dept ? [i] : []));
    ensure(mine[0], ["RESOLVED", "CLOSED"]);
    ensure(mine[1], ["ASSIGNED", "IN_PROGRESS"]);
    ensure(mine[2], ["RESOLVED"]);
    recent.add(mine[2]);
    if (dept === "ENG") { ensure(mine[3], ["RESOLVED"]); recent.add(mine[3]); }
  }

  const newHires = base.newHireIds;
  let hireCursor = 0;
  let personaAssigned = 0;
  const specs: Spec[] = texts.map((t, i) => {
    const status = statuses[i];
    const priority = priorities[i];
    const isIt = (t.category === "IT_EQUIPMENT" || t.category === "SOFTWARE_ACCESS") && !t.rerouted;

    // New hires raise several IT requests that are still open (feeds the cross-module insight).
    let requesterId: string;
    if (isIt && OPEN.includes(status) && hireCursor < 5) requesterId = newHires[hireCursor++];
    else if (!isIt && i % 6 === 0) requesterId = newHires[i % newHires.length];
    else requesterId = pick(requesters).id;

    // Assignee: an employee of the handling department; the IT persona gets the first few IT requests that have one.
    let assigneeId: string | null = null;
    if (status !== "SUBMITTED") {
      const pool = workers(deptIdOf.get(t.department)!);
      if (t.department === "ITOPS" && personaAssigned < 7 && requesterId !== base.personas.itSupport) {
        assigneeId = base.personas.itSupport;
        personaAssigned++;
      } else {
        do assigneeId = pick(pool).id; while (assigneeId === requesterId && pool.length > 1);
      }
    }

    // How long each step takes. Urgent work is picked up and finished fast, low-priority work waits; so some requests are
    // done the same day and others take days, and "time to resolve" is worth looking at.
    const steps = ["SUBMITTED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"].indexOf(status);
    const resolveHours = priority === "URGENT" ? int(2, 24) : priority === "HIGH" ? int(8, 72) : priority === "MEDIUM" ? int(12, 120) : int(24, 168);
    const gapsHours = [priority === "URGENT" ? int(1, 4) : int(1, 30), int(1, 24), resolveHours, int(4, 72)].slice(0, steps);

    // Older requests are further along, and the finished ones are spread over the whole 90 days. The newest event is
    // always at least two hours in the past.
    const age = recent.has(i) ? int(2, 22) : status === "CLOSED" ? int(20, 88) : status === "RESOLVED" ? int(1, 45) : status === "IN_PROGRESS" ? int(2, 25) : status === "ASSIGNED" ? int(1, 12) : int(0, 6);
    const spanMs = gapsHours.reduce((a, b) => a + b, 0) * HOUR;
    const createdAt = Date.now() - Math.max(age * DAY + int(0, 20) * HOUR, spanMs + 2 * HOUR);
    return { ...t, status, priority, requesterId, assigneeId, createdAt, gapsHours };
  });
  specs.sort((a, b) => a.createdAt - b.createdAt); // SR-1001 is the oldest

  const createdIds: { id: string; spec: Spec; lastEvent: number }[] = [];
  for (const spec of specs) {
    const requester = byId.get(spec.requesterId)!;
    const deptId = deptIdOf.get(spec.department)!;
    const head = headOf.get(deptId)!;
    // The head assigns, unless the head is the requester (then HR does).
    const assigner = head !== spec.requesterId ? head : base.personas.hrAdmin;

    // Build the history to match the final status.
    const chain: RequestStatus[] = ["SUBMITTED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];
    const steps = chain.slice(0, chain.indexOf(spec.status) + 1);
    let t = spec.createdAt;
    const events: Prisma.RequestEventCreateManyRequestInput[] = steps.map((to, idx) => {
      if (idx > 0) t += spec.gapsHours[idx - 1] * HOUR;
      const from = idx === 0 ? null : steps[idx - 1];
      const actorId = to === "SUBMITTED" ? requester.id : to === "ASSIGNED" ? assigner : to === "CLOSED" ? (rand() < 0.6 ? requester.id : base.personas.hrAdmin) : spec.assigneeId!;
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

  // Comment threads (2–4 comments) on 12 requests that have people involved.
  const threaded = createdIds.filter((c) => c.spec.status !== "SUBMITTED").slice(0, 12);
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
