import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../src/generated/prisma/client";
import type { RoleCode, StatusCode } from "../../src/lib/lookups";
import {
  CATEGORIES, COUNTRY_COUNTS, COUNTRY_ROWS, DEPARTMENTS, EMAIL_DOMAIN, NAMES, NEW_HIRES, PERSONA_EMAILS, ROLE_ROWS, STATUS_ROWS,
  type Shortcode,
} from "./data";

/** Small deterministic PRNG so every seed run produces the same people. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TABLES = [
  "chat_drafts",
  "request_comments", "request_events", "service_requests", "request_categories",
  "onboarding_tasks", "onboarding_instances", "template_tasks", "onboarding_templates",
  "users", "departments",
];

/**
 * Makes sure the rows of the role, country and status tables exist (the migration normally created them) and returns functions that
 * turn a code into the row's id. The seed refers to these rows by code only: ids differ between databases.
 */
export async function ensureLookups(db: PrismaClient) {
  for (const [code, name] of ROLE_ROWS) await db.role.upsert({ where: { code }, update: { name }, create: { code, name } });
  for (const [shortcode, name] of COUNTRY_ROWS) await db.country.upsert({ where: { shortcode }, update: { name }, create: { shortcode, name } });
  for (const [code, name] of STATUS_ROWS) await db.userStatus.upsert({ where: { code }, update: { name }, create: { code, name } });
  const [roles, countries, statuses] = await Promise.all([db.role.findMany(), db.country.findMany(), db.userStatus.findMany()]);
  const idOf = <K extends string>(rows: { id: string }[], key: (r: never) => K, what: string) => (k: K) => {
    const row = rows.find((r) => key(r as never) === k);
    if (!row) throw new Error(`No ${what} row for ${k}`);
    return row.id;
  };
  return {
    role: idOf<RoleCode>(roles, (r: { code: RoleCode }) => r.code, "role"),
    country: idOf<Shortcode>(countries, (r: { shortcode: Shortcode }) => r.shortcode, "country"),
    status: idOf<StatusCode>(statuses, (r: { code: StatusCode }) => r.code, "status"),
  };
}

/** Deletes all application data and resets the SR- sequence. */
export async function clearAll(db: PrismaClient) {
  await db.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await db.$executeRawUnsafe(`ALTER SEQUENCE service_request_ref_seq RESTART WITH 1001`);
}

interface Planned {
  id: string;
  deptCode: string;
  role: RoleCode;
  title: string;
  country: Shortcode;
  managerId: string | null;
  status: StatusCode;
  joinedDaysAgo: number;
  fullName: string;
  email: string;
}

const dateDaysAgo = (days: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
};

/**
 * Seed part 1 (spec §7): departments with exactly one Manager each (who heads it), 100 users, request categories.
 * Assumes empty tables. Later parts (requests, onboarding) build on the returned references.
 */
export async function seedBase(db: PrismaClient, passwordHash: string) {
  const lookups = await ensureLookups(db);
  const rand = mulberry32(20260101);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

  // 100 country slots in the exact required split, shuffled (Fisher-Yates).
  const slots = (Object.entries(COUNTRY_COUNTS) as [Shortcode, number][]).flatMap(([c, n]) => Array<Shortcode>(n).fill(c));
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  const usedNames = new Set<string>();
  const usedEmails = new Set<string>();
  const person = (country: Shortcode) => {
    const pool = NAMES[country];
    for (;;) {
      const first = pick(pool.first), last = pick(pool.last);
      const fullName = `${first} ${last}`;
      if (usedNames.has(fullName)) continue;
      usedNames.add(fullName);
      let local = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "");
      let email = `${local}@${EMAIL_DOMAIN}`;
      for (let n = 2; usedEmails.has(email); n++) email = `${local}${n}@${EMAIL_DOMAIN}`;
      usedEmails.add(email);
      return { fullName, email };
    }
  };

  // ── plan every person ──
  const planned: Planned[] = [];
  const headOf = new Map<string, Planned>();
  let slot = 0;
  const add = (deptCode: string, role: RoleCode, title: string, joinedDaysAgo: number, managerId: string | null) => {
    const country = slots[slot++];
    const p: Planned = { id: randomUUID(), deptCode, role, title, country, managerId, status: "ACTIVE", joinedDaysAgo, ...person(country) };
    planned.push(p);
    return p;
  };

  for (const d of DEPARTMENTS) {
    const head = add(d.code, "MANAGER", d.headTitle, int(1200, 3000), null);
    headOf.set(d.code, head);
    for (let i = 0; i < d.hrAdmins; i++) add(d.code, "HR_ADMIN", i === 0 ? "HR Operations Lead" : "HR Administrator", int(600, 2500), head.id);
    for (let i = 0; i < d.employees; i++) add(d.code, "EMPLOYEE", pick(d.employeeTitles), int(100, 2200), head.id);
  }

  // ── statuses ──
  const employees = planned.filter((p) => p.role === "EMPLOYEE");
  const taken = new Set<string>();

  // 7 designated new hires (T17 onboards them), joined 10–55 days ago, spread over countries and departments.
  const newHires: Planned[] = [];
  for (const want of NEW_HIRES) {
    const eligible = (e: Planned) => e.country === want.country && !taken.has(e.id) && e.deptCode !== "PEOPLE";
    const p = employees.find((e) => eligible(e) && e.deptCode === want.department) ?? employees.find(eligible);
    if (!p) throw new Error(`No eligible employee in ${want.country} for a new hire`);
    taken.add(p.id);
    p.status = "ON_PROBATION";
    p.joinedDaysAgo = int(10, 55);
    newHires.push(p);
  }
  // 3 more on probation (joined a bit earlier), 4 on notice.
  const pickFree = (filter: (p: Planned) => boolean) => {
    const p = employees.find((e) => !taken.has(e.id) && filter(e));
    if (!p) throw new Error("Not enough employees for the status plan");
    taken.add(p.id);
    return p;
  };
  for (let i = 0; i < 3; i++) { const p = pickFree((e) => e.deptCode !== "ITOPS"); p.status = "ON_PROBATION"; p.joinedDaysAgo = int(60, 150); }
  for (const country of COUNTRY_ROWS.map(([shortcode]) => shortcode)) {
    pickFree((e) => e.country === country && e.deptCode !== "ITOPS").status = "ON_NOTICE";
  }

  // ── personas with fixed, documented logins ──
  const hrAdmin = planned.find((p) => p.role === "HR_ADMIN")!;
  hrAdmin.email = PERSONA_EMAILS.hrAdmin;
  const personaHire = newHires[0];
  personaHire.email = PERSONA_EMAILS.newHire;
  const personaManager = planned.find((p) => p.id === personaHire.managerId)!;
  personaManager.email = PERSONA_EMAILS.manager;
  const itSupport = pickFree((e) => e.deptCode === "ITOPS");
  itSupport.email = PERSONA_EMAILS.itSupport;

  // ── write ──
  const deptIds = new Map(DEPARTMENTS.map((d) => [d.code, randomUUID()]));
  await db.department.createMany({ data: DEPARTMENTS.map((d) => ({ id: deptIds.get(d.code)!, code: d.code, name: d.name })) });

  // One statement: self-references (manager_id) are checked at the end of the statement.
  await db.user.createMany({
    data: planned.map((p, i) => ({
      id: p.id,
      employeeCode: `EMP-${String(i + 1).padStart(4, "0")}`,
      fullName: p.fullName,
      email: p.email,
      passwordHash,
      roleId: lookups.role(p.role),
      countryId: lookups.country(p.country),
      departmentId: deptIds.get(p.deptCode)!,
      managerId: p.managerId,
      jobTitle: p.title,
      joiningDate: dateDaysAgo(p.joinedDaysAgo),
      statusId: lookups.status(p.status),
    })),
  });
  for (const d of DEPARTMENTS) {
    await db.department.update({ where: { id: deptIds.get(d.code)! }, data: { headId: headOf.get(d.code)!.id } });
  }
  await db.requestCategory.createMany({
    data: CATEGORIES.map((c) => ({ code: c.code, name: c.name, handlingDepartmentId: deptIds.get(c.department)! })),
  });

  return {
    departmentIds: Object.fromEntries(deptIds) as Record<string, string>,
    personas: {
      hrAdmin: hrAdmin.id,
      manager: personaManager.id,
      newHire: personaHire.id,
      itSupport: itSupport.id,
    },
    /** Users designated as new hires; the onboarding seed (T17) assigns their checklists. */
    newHireIds: newHires.map((p) => p.id),
  };
}
