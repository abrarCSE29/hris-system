import { prisma } from "./prisma";
import { ROLE_CODES, STATUS_CODES, type CountryRef, type LookupRef } from "./lookups";

const byOrder = (order: readonly string[]) => (a: LookupRef, b: LookupRef) => {
  const ia = order.indexOf(a.code), ib = order.indexOf(b.code);
  return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib) || a.name.localeCompare(b.name);
};

/**
 * The three lookup lists, in a fixed display order: roles and statuses in their natural order, countries by name (there is no sort
 * column). Used wherever every value must be listed, with zeros, so charts and tables never miss a row.
 */
export async function loadLookups(): Promise<{ roles: LookupRef[]; countries: CountryRef[]; statuses: LookupRef[] }> {
  const [roles, countries, statuses] = await Promise.all([
    prisma.role.findMany({ select: { id: true, code: true, name: true } }),
    prisma.country.findMany({ select: { id: true, shortcode: true, name: true }, orderBy: { name: "asc" } }),
    prisma.userStatus.findMany({ select: { id: true, code: true, name: true } }),
  ]);
  return { roles: roles.sort(byOrder(ROLE_CODES)), countries, statuses: statuses.sort(byOrder(STATUS_CODES)) };
}
