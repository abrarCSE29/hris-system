import "dotenv/config";
import { createPrismaClient } from "../src/lib/create-prisma";

/**
 * Used by `docker compose up`: adds the demo data only when the database has no people yet, so restarting never wipes
 * anything. (`npm run db:seed` always wipes; this never does.)
 */
async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const db = createPrismaClient(url);
  let people: number;
  try {
    people = await db.user.count();
  } finally {
    await db.$disconnect();
  }

  if (people > 0) {
    console.log(`The database already has ${people} people; leaving it as it is.`);
    return;
  }
  await import("./seed");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
