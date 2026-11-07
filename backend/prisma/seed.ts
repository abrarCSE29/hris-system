import "dotenv/config";
import bcrypt from "bcryptjs";
import { createPrismaClient } from "../src/lib/create-prisma";
import { seedBase, clearAll } from "./seed/base";
import { seedOnboarding } from "./seed/onboarding";
import { seedRequests } from "./seed/requests";
import { PERSONA_EMAILS, SEED_PASSWORD } from "./seed/data";

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  // This script DELETES all data. Anything other than a local database needs an explicit opt-in.
  const host = new URL(url).hostname;
  const local = ["localhost", "127.0.0.1", "::1"].includes(host);
  if (!local && process.env.SEED_CONFIRM !== "yes") {
    throw new Error(`Refusing to wipe and seed non-local database "${host}". Re-run with SEED_CONFIRM=yes to proceed.`);
  }
  if (!local && !process.env.SEED_PASSWORD) {
    throw new Error("Set SEED_PASSWORD when seeding a non-local database (the default is for local development only).");
  }

  const db = createPrismaClient(url);
  try {
    console.log(`Seeding ${host} …`);
    await clearAll(db);
    const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
    const base = await seedBase(db, passwordHash);
    const { requestCount } = await seedRequests(db, base);
    const { templateCount, instanceCount } = await seedOnboarding(db, base);
    console.log(`Created ${await db.department.count()} departments, ${await db.user.count()} users, ${requestCount} requests, ${templateCount} templates, ${instanceCount} onboardings.`);
    console.log("Demo logins (password: see SEED_PASSWORD in prisma/seed/data.ts):");
    for (const [role, email] of Object.entries(PERSONA_EMAILS)) console.log(`  ${role.padEnd(10)} ${email}`);
    return base;
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
