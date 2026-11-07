import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export function createPrismaClient(connectionString: string | undefined) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  // max: 1 per serverless instance keeps us within the Supabase pooler's limits (transaction mode).
  const adapter = new PrismaPg({ connectionString, max: 1 });
  return new PrismaClient({ adapter });
}
