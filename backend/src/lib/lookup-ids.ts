import { ApiError } from "./errors";
import { prisma } from "./prisma";

type Kind = "role" | "country" | "status";
const LABEL: Record<Kind, string> = { role: "Role", country: "Country", status: "Status" };

/**
 * A role, country or status id sent by a client must be one that exists. An unknown id is a 422 that names the field, rather than
 * an empty list or a database error. Does nothing when no id was sent.
 */
export async function requireLookupId(kind: Kind, id: string | undefined, path: string): Promise<void> {
  if (id === undefined) return;
  const where = { id };
  const found =
    kind === "role" ? await prisma.role.findUnique({ where, select: { id: true } })
    : kind === "country" ? await prisma.country.findUnique({ where, select: { id: true } })
    : await prisma.userStatus.findUnique({ where, select: { id: true } });
  if (!found) throw new ApiError("VALIDATION_FAILED", `Unknown ${LABEL[kind].toLowerCase()}`, [{ path, message: `${LABEL[kind]} not found` }]);
}
