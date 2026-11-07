import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as login } from "../app/api/v1/auth/login/route";
import { GET as getUsers, POST as createUser } from "../app/api/v1/users/route";
import { clearAll, seedBase } from "../prisma/seed/base";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { db } from "./db";

let ids: Awaited<ReturnType<typeof seedBase>>;
let deptId: string;

beforeAll(async () => {
  await clearAll(db);
  ids = await seedBase(db, await bcrypt.hash("x", 4));
  deptId = ids.departmentIds.ENG;
});
afterAll(() => db.$disconnect());

const body = (over: Record<string, unknown> = {}) => ({
  fullName: "Test Person",
  email: "test.person@hris.test",
  country: "MALAYSIA",
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
      fullName: "Test Person", email: "test.person@hris.test", role: "EMPLOYEE", status: "ON_PROBATION",
      country: "MALAYSIA", managerId: ids.personas.manager, joiningDate: "2026-11-02", employeeCode: "EMP-0101",
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
    expect(def.user.status).toBe("ON_PROBATION");
    const probation = await json(await post(hr(), body({ email: "status.prob@hris.test", status: "ON_PROBATION" })));
    expect(probation.user.status).toBe("ON_PROBATION");
    const active = await post(hr(), body({ email: "status.active@hris.test", status: "ACTIVE" }));
    expect(active.status).toBe(201);
    expect((await json(active)).user.status).toBe("ACTIVE");
    expect((await db.user.findUniqueOrThrow({ where: { email: "status.active@hris.test" } })).status).toBe("ACTIVE");
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
    ["unknown country", { country: "ATLANTIS" }],
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

  it("rejects unknown fields, so a role cannot be smuggled in", async () => {
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
