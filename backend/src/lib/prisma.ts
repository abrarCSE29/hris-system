import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "./create-prisma";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function client(): PrismaClient {
  // One client per server instance. Also survives Next.js dev hot-reload without opening a new pool each edit.
  return (globalForPrisma.prisma ??= createPrismaClient(process.env.DATABASE_URL));
}

/**
 * The database client, created on first use rather than when the module is imported.
 * That way `next build` works on a fresh deployment where DATABASE_URL isn't available yet,
 * and a missing variable fails the first real request with a clear message instead of the build.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client();
    const value = Reflect.get(c, prop, c);
    return typeof value === "function" ? value.bind(c) : value;
  },
});
