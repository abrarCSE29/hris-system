import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * The migration that moves role, country and status to lookup tables (T31). It runs on a scratch database that is first brought to the
 * state before it, holding a user for every old role, country and status combination, so a wrong mapping cannot hide.
 */
const MIGRATION = "20261110090000_user_lookup_tables";
const ADMIN_URL = process.env.TEST_ADMIN_URL ?? "postgresql://hris:hris@localhost:5433/postgres";
const SCRATCH = "hris_migration_scratch";
const dir = join(__dirname, "..", "prisma", "migrations");
const sqlOf = (name: string) => readFileSync(join(dir, name, "migration.sql"), "utf8");
const before = () => readdirSync(dir).filter((n) => /^\d{14}_/.test(n) && n < MIGRATION).sort();

const ROLES = ["EMPLOYEE", "MANAGER", "HR_ADMIN"];
const COUNTRIES = ["BANGLADESH", "MALAYSIA", "SRI_LANKA", "CYPRUS"];
const STATUSES = ["ACTIVE", "ON_PROBATION", "ON_NOTICE"];
const SHORTCODE: Record<string, string> = { BANGLADESH: "BD", MALAYSIA: "MY", SRI_LANKA: "LK", CYPRUS: "CY" };

let admin: Client;
let c: Client;

async function freshScratch() {
  await c?.end().catch(() => {}); // a connection still open would be cut off when the database is dropped
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${SCRATCH}`);
  c = new Client({ connectionString: ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`) });
  await c.connect();
  // Prisma's own bookkeeping table; one of the earlier migrations switches row-level security on for it.
  await c.query(`CREATE TABLE "_prisma_migrations" (id text)`);
  for (const name of before()) await c.query(sqlOf(name));
}

async function addLegacyUsers() {
  await c.query(`INSERT INTO departments (id, code, name) VALUES ('00000000-0000-4000-8000-000000000001', 'D', 'Dept')`);
  let i = 0;
  for (const role of ROLES) for (const country of COUNTRIES) for (const status of STATUSES) {
    i++;
    await c.query(
      `INSERT INTO users (id, employee_code, full_name, email, password_hash, role, country, department_id, job_title, joining_date, status)
       VALUES (gen_random_uuid(), $1, $2, $3, 'x', $4, $5, '00000000-0000-4000-8000-000000000001', 'Engineer', '2024-01-01', $6)`,
      [`E${i}`, `${role}/${country}/${status}`, `u${i}@example.com`, role, country, status],
    );
  }
}

beforeAll(async () => {
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
});
afterAll(async () => {
  await c?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await admin.end();
});

describe("user lookup tables migration", () => {
  it("gives every old role, country and status combination its matching row, and loses nobody", async () => {
    await freshScratch();
    await addLegacyUsers();
    await c.query(sqlOf(MIGRATION));

    const { rows } = await c.query(
      `SELECT u.full_name, r.code AS role, co.shortcode, s.code AS status
         FROM users u JOIN roles r ON r.id = u.role_id JOIN countries co ON co.id = u.country_id JOIN user_statuses s ON s.id = u.status_id`,
    );
    expect(rows).toHaveLength(ROLES.length * COUNTRIES.length * STATUSES.length);
    for (const row of rows) {
      const [role, country, status] = row.full_name.split("/");
      expect([row.role, row.shortcode, row.status]).toEqual([role, SHORTCODE[country], status]);
    }
  });

  it("creates the lookup rows with their names", async () => {
    const q = async (sql: string) => (await c.query(sql)).rows;
    expect(await q(`SELECT code, name FROM roles ORDER BY code`)).toEqual([
      { code: "EMPLOYEE", name: "Employee" }, { code: "HR_ADMIN", name: "HR Admin" }, { code: "MANAGER", name: "Manager" },
    ]);
    expect(await q(`SELECT shortcode, name FROM countries ORDER BY shortcode`)).toEqual([
      { shortcode: "BD", name: "Bangladesh" }, { shortcode: "CY", name: "Cyprus" }, { shortcode: "LK", name: "Sri Lanka" }, { shortcode: "MY", name: "Malaysia" },
    ]);
    expect(await q(`SELECT code, name FROM user_statuses ORDER BY code`)).toEqual([
      { code: "ACTIVE", name: "Active" }, { code: "ON_NOTICE", name: "On notice" }, { code: "ON_PROBATION", name: "On probation" },
    ]);
  });

  it("removes the old columns and enum types, and keeps row-level security on with no policies", async () => {
    const cols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(["role_id", "country_id", "status_id"]));
    expect(cols).not.toEqual(expect.arrayContaining(["role"]));
    expect(cols.filter((n) => ["role", "country", "status"].includes(n))).toEqual([]);
    const types = (await c.query(`SELECT typname FROM pg_type WHERE typname IN ('Role', 'Country', 'UserStatus')`)).rows;
    expect(types).toEqual([]);
    const rls = (await c.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('roles', 'countries', 'user_statuses')`)).rows;
    expect(rls).toHaveLength(3);
    expect(rls.every((r) => r.relrowsecurity)).toBe(true);
    expect((await c.query(`SELECT 1 FROM pg_policies WHERE tablename IN ('roles', 'countries', 'user_statuses')`)).rows).toEqual([]);
  });

  it("enforces the rules: unique codes, a two-capital-letter shortcode, no orphan or deletable-in-use rows", async () => {
    await expect(c.query(`INSERT INTO roles (id, code, name) VALUES (gen_random_uuid(), 'MANAGER', 'Again')`)).rejects.toThrow(/roles_code_key/);
    await expect(c.query(`INSERT INTO countries (id, shortcode, name) VALUES (gen_random_uuid(), 'BD', 'Again')`)).rejects.toThrow(/countries_shortcode_key/);
    await expect(c.query(`INSERT INTO user_statuses (id, code, name) VALUES (gen_random_uuid(), 'ACTIVE', 'Again')`)).rejects.toThrow(/user_statuses_code_key/);
    for (const bad of ["bd", "BGD", "B", "B1", ""]) {
      await expect(c.query(`INSERT INTO countries (id, shortcode, name) VALUES (gen_random_uuid(), $1, 'X')`, [bad])).rejects.toThrow(/countries_shortcode_format/);
    }
    await expect(c.query(`DELETE FROM roles WHERE code = 'MANAGER'`)).rejects.toThrow(/users_role_id_fkey/);
    await expect(c.query(`DELETE FROM countries WHERE shortcode = 'BD'`)).rejects.toThrow(/users_country_id_fkey/);
    await expect(c.query(`DELETE FROM user_statuses WHERE code = 'ACTIVE'`)).rejects.toThrow(/users_status_id_fkey/);
    await expect(
      c.query(`UPDATE users SET role_id = gen_random_uuid() WHERE employee_code = 'E1'`),
    ).rejects.toThrow(/users_role_id_fkey/);
    await expect(c.query(`UPDATE users SET country_id = NULL WHERE employee_code = 'E1'`)).rejects.toThrow(/not-null|null value/);
  });

  it("is one-row-at-a-time cheap to use: a role change is one foreign key on one user", async () => {
    const res = await c.query(
      `UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'MANAGER') WHERE employee_code = 'E1'`,
    );
    expect(res.rowCount).toBe(1);
  });

  it("stops and changes nothing if a user cannot be matched", async () => {
    await freshScratch();
    await addLegacyUsers();
    // A value the migration does not know, as if a fourth country had been added to the old enum.
    await c.query(`ALTER TYPE "Country" ADD VALUE 'NEPAL'`);
    await c.query(`UPDATE users SET country = 'NEPAL' WHERE employee_code = 'E1'`);
    await expect(c.query(sqlOf(MIGRATION))).rejects.toThrow(/could not be matched/);
    // All or nothing: the old shape is intact and no lookup table was left behind.
    const cols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(["role", "country", "status"]));
    expect(cols).not.toContain("role_id");
    expect((await c.query(`SELECT to_regclass('roles') AS t`)).rows[0].t).toBeNull();
  });
});
