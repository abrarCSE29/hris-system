import { execSync } from "node:child_process";
import { Client } from "pg";

export const TEST_DB_NAME = "hris_test";
const ADMIN_URL = process.env.TEST_ADMIN_URL ?? "postgresql://hris:hris@localhost:5433/postgres";
const TEST_URL = process.env.TEST_DATABASE_URL ?? `postgresql://hris:hris@localhost:5433/${TEST_DB_NAME}`;

/** Creates the test database if needed and applies all migrations to it. Requires `npm run db:up`. */
export default async function setup() {
  const admin = new Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (e) {
    throw new Error(`Cannot reach Postgres at ${ADMIN_URL}. Run "npm run db:up" first. (${(e as Error).message})`);
  }
  const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (rows.length === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();

  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DIRECT_URL: TEST_URL, DATABASE_URL: TEST_URL },
  });
}
