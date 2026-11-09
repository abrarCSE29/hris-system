import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as login } from "../app/api/v1/auth/login/route";
import { GET as getUsers, POST as createUser } from "../app/api/v1/users/route";
import { clearAll, seedBase } from "../prisma/seed/base";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { countryId, db, roleId, statusId } from "./db";

let ids: Awaited<ReturnType<typeof seedBase>>;
let deptId: string;
let malaysiaId: string, activeId: string, probationId: string, onNoticeId: string;

beforeAll(async () => {
  await clearAll(db);
  ids = await seedBase(db, await bcrypt.hash("x", 4));
  deptId = ids.departmentIds.ENG;
  [malaysiaId, activeId, probationId, onNoticeId] = await Promise.all([countryId("MY"), statusId("ACTIVE"), statusId("ON_PROBATION"), statusId("ON_NOTICE")]);
});
afterAll(() => db.$disconnect());

const body = (over: Record<string, unknown> = {}) => ({
  fullName: "Test Person",
  email: "test.person@hris.test",
  countryId: malaysiaId,
  departmentId: deptId,
  managerId: ids.personas.manager,
  jobTitle: "Software Engineer",
  joiningDate: "2026-11-02",
  ...over,
});
const post = async (userId: string | null, payload: unknown) =>
  createUser(
    new Request("http://x/api/v1/users", {
      method: "POST",
      headers: { "content-type": "application/json", ...(userId && { cookie: `${SESSION_COOKIE}=${await signSession(userId)}` }) },
      body: JSON.stringify(payload),
    }),
  );
const json = async (res: Response) => (await res.json()) as any;
const loginAs = (email: string, password: string) =>
  login(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));

describe("POST /users", () => {
  const hr = () => ids.personas.hrAdmin;

  it("is HR-only", async () => {
    expect((await post(null, body())).status).toBe(401);
    expect((await post(ids.personas.manager, body())).status).toBe(403);
    expect((await post(ids.personas.newHire, body())).status).toBe(403);
    expect(await db.user.count()).toBe(100);
  });

  it("creates an Employee on probation with a generated one-time password", async () => {
    const res = await post(hr(), body({ fullName: "  Test Person ", email: "  Test.Person@HRIS.test " }));
    const out = await json(res);
    expect(res.status).toBe(201);
    expect(out.user).toMatchObject({
      fullName: "Test Person", email: "test.person@hris.test", role: { code: "EMPLOYEE" }, status: { code: "ON_PROBATION" },
      country: { shortcode: "MY", name: "Malaysia" }, managerId: ids.personas.manager, joiningDate: "2026-11-02", employeeCode: "EMP-0101",
    });
    expect(JSON.stringify(out)).not.toMatch(/passwordHash/);
    expect(typeof out.temporaryPassword).toBe("string");
    expect(out.temporaryPassword.length).toBeGreaterThanOrEqual(16);

    const row = await db.user.findUniqueOrThrow({ where: { email: "test.person@hris.test" } });
    expect(row.passwordHash).not.toContain(out.temporaryPassword);
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
    expect((await loginAs("test.person@hris.test", out.temporaryPassword)).status).toBe(200);
  });

  it("starts people on probation by default, or Active when HR says so", async () => {
    const def = await json(await post(hr(), body({ email: "status.default@hris.test" })));
    expect(def.user.status.code).toBe("ON_PROBATION");
    const probation = await json(await post(hr(), body({ email: "status.prob@hris.test", statusId: probationId })));
    expect(probation.user.status.code).toBe("ON_PROBATION");
    const active = await post(hr(), body({ email: "status.active@hris.test", statusId: activeId }));
    expect(active.status).toBe(201);
    expect((await json(active)).user.status.code).toBe("ACTIVE");
    expect((await db.user.findUniqueOrThrow({ where: { email: "status.active@hris.test" }, include: { status: true } })).status.code).toBe("ACTIVE");
  });

  it("does not let a new person start On notice, or with an invented status", async () => {
    for (const status of ["ON_NOTICE", "RETIRED", ""]) {
      const res = await post(hr(), body({ email: "status.bad@hris.test", status }));
      expect(res.status, status).toBe(422);
    }
    expect(await db.user.count({ where: { email: "status.bad@hris.test" } })).toBe(0);
  });

  it("uses the password HR supplies and does not echo it back", async () => {
    const res = await post(hr(), body({ email: "chosen@hris.test", password: "a-chosen-password" }));
    const out = await json(res);
    expect(res.status).toBe(201);
    expect(out.temporaryPassword).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("a-chosen-password");
    expect((await loginAs("chosen@hris.test", "a-chosen-password")).status).toBe(200);
  });

  it("allocates sequential employee codes", async () => {
    const a = await json(await post(hr(), body({ email: "seq.a@hris.test" })));
    const b = await json(await post(hr(), body({ email: "seq.b@hris.test" })));
    const n = (c: string) => Number(c.slice(4));
    expect(n(b.user.employeeCode)).toBe(n(a.user.employeeCode) + 1);
  });

  it("rejects duplicate emails regardless of case with 409", async () => {
    expect((await post(hr(), body({ email: "dup@hris.test" }))).status).toBe(201);
    const res = await post(hr(), body({ email: "DUP@hris.test" }));
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("CONFLICT");
  });

  it.each([
    ["missing fullName", { fullName: undefined }],
    ["blank jobTitle", { jobTitle: "  " }],
    ["bad email", { email: "not-an-email" }],
    ["country that is not an id", { countryId: "ATLANTIS" }],
    ["the old country field", { country: "MALAYSIA" }],
    ["status that is not an id", { statusId: "ACTIVE" }],
    ["bad date", { joiningDate: "02/11/2026" }],
    ["impossible date", { joiningDate: "2026-02-31" }],
    ["short password", { password: "short" }],
    ["non-uuid department", { departmentId: "nope" }],
    ["non-uuid manager", { managerId: "nope" }],
  ])("returns 422 for %s", async (_name, over) => {
    const res = await post(hr(), body({ email: "bad@hris.test", ...over }));
    expect(res.status).toBe(422);
    expect(await db.user.count({ where: { email: "bad@hris.test" } })).toBe(0);
  });

  it("returns 422 for a country or status id that does not exist, and for a status a new person cannot start with", async () => {
    const noCountry = await post(hr(), body({ email: "c1@hris.test", countryId: crypto.randomUUID() }));
    expect(noCountry.status).toBe(422);
    expect((await json(noCountry)).error.details[0].path).toBe("countryId");
    const noStatus = await post(hr(), body({ email: "c2@hris.test", statusId: crypto.randomUUID() }));
    expect(noStatus.status).toBe(422);
    expect((await json(noStatus)).error.details[0].path).toBe("statusId");
    const onNotice = await post(hr(), body({ email: "c3@hris.test", statusId: onNoticeId }));
    expect(onNotice.status).toBe(422);
    expect((await json(onNotice)).error.details[0].path).toBe("statusId");
    expect(await db.user.count({ where: { email: { in: ["c1@hris.test", "c2@hris.test", "c3@hris.test"] } } })).toBe(0);
  });

  it("returns 422 for an unknown department or a manager who is not a Manager", async () => {
    const noDept = await post(hr(), body({ email: "x1@hris.test", departmentId: crypto.randomUUID() }));
    expect(noDept.status).toBe(422);
    expect((await json(noDept)).error.details[0].path).toBe("departmentId");
    const notMgr = await post(hr(), body({ email: "x2@hris.test", managerId: ids.personas.newHire }));
    expect(notMgr.status).toBe(422);
    expect((await json(notMgr)).error.details[0].path).toBe("managerId");
    const ghost = await post(hr(), body({ email: "x3@hris.test", managerId: crypto.randomUUID() }));
    expect(ghost.status).toBe(422);
  });

  describe("role", () => {
    it("defaults to Employee, and HR can choose Employee or HR Admin explicitly", async () => {
      const def = await json(await post(hr(), body({ email: "role.default@hris.test" })));
      expect(def.user.role.code).toBe("EMPLOYEE");
      const emp = await json(await post(hr(), body({ email: "role.emp@hris.test", roleId: await roleId("EMPLOYEE") })));
      expect(emp.user.role).toMatchObject({ code: "EMPLOYEE", name: "Employee" });
      const admin = await post(hr(), body({ email: "role.admin@hris.test", roleId: await roleId("HR_ADMIN") }));
      expect(admin.status).toBe(201);
      expect((await json(admin)).user.role).toMatchObject({ code: "HR_ADMIN", name: "HR Admin" });
      expect((await db.user.findUniqueOrThrow({ where: { email: "role.admin@hris.test" }, include: { role: true } })).role.code).toBe("HR_ADMIN");
    });

    it("makes a Manager the listed head of a department that has none, and allows only one Manager per department", async () => {
      const empty = await db.department.create({ data: { code: "NEWDEPT", name: "New Department" } });
      const first = await post(hr(), body({ email: "mgr.one@hris.test", departmentId: empty.id, roleId: await roleId("MANAGER") }));
      expect(first.status).toBe(201);
      const created = (await json(first)).user;
      expect(created.role.code).toBe("MANAGER");
      expect((await db.department.findUniqueOrThrow({ where: { id: empty.id } })).headId).toBe(created.id);

      const second = await post(hr(), body({ email: "mgr.two@hris.test", departmentId: empty.id, roleId: await roleId("MANAGER") }));
      expect(second.status).toBe(422);
      expect((await json(second)).error.details[0].path).toBe("roleId");
      expect(await db.user.count({ where: { email: "mgr.two@hris.test" } })).toBe(0);
      // A seeded department already has its Manager.
      const eng = await post(hr(), body({ email: "mgr.eng@hris.test", roleId: await roleId("MANAGER") }));
      expect(eng.status).toBe(422);
    });

    it("does not change the listed head when a non-Manager joins", async () => {
      const before = (await db.department.findUniqueOrThrow({ where: { id: deptId } })).headId;
      await post(hr(), body({ email: "role.nohead@hris.test", roleId: await roleId("HR_ADMIN") }));
      expect((await db.department.findUniqueOrThrow({ where: { id: deptId } })).headId).toBe(before);
    });

    it("returns 422 naming roleId for a role that does not exist or is not an id", async () => {
      const ghost = await post(hr(), body({ email: "role.ghost@hris.test", roleId: crypto.randomUUID() }));
      expect(ghost.status).toBe(422);
      expect((await json(ghost)).error.details[0].path).toBe("roleId");
      expect((await post(hr(), body({ email: "role.bad@hris.test", roleId: "MANAGER" }))).status).toBe(422);
      expect(await db.user.count({ where: { email: { in: ["role.ghost@hris.test", "role.bad@hris.test"] } } })).toBe(0);
    });
  });

  it("rejects the old role field, which is not an id", async () => {
    const res = await post(hr(), body({ email: "sneaky@hris.test", role: "HR_ADMIN" }));
    expect(res.status).toBe(422);
    expect(await db.user.count({ where: { email: "sneaky@hris.test" } })).toBe(0);
  });

  it("rejects malformed JSON with 422", async () => {
    const res = await createUser(new Request("http://x", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${await signSession(hr())}` }, body: "{oops" }));
    expect(res.status).toBe(422);
  });

  it("makes the new user visible to their manager's team list", async () => {
    await post(hr(), body({ email: "visible@hris.test" }));
    const list = await json(
      await getUsers(new Request("http://x/api/v1/users?search=visible@hris.test", { headers: { cookie: `${SESSION_COOKIE}=${await signSession(ids.personas.manager)}` } })),
    );
    expect(list.total).toBe(1);
  });
});
