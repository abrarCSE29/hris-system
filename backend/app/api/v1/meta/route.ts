import { NextResponse } from "next/server";
import { OnboardingTaskStatus, OwnerType, RequestPriority, RequestStatus } from "@/generated/prisma/client";
import { loadLookups } from "@/lib/lookup-lists";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/with-auth";

const values = <T extends Record<string, string>>(e: T) => Object.values(e);

/**
 * Reference data for form dropdowns and filters: departments, request categories, the role, country and status lists (with the ids
 * the filters and the new-user form send) and the enum values that are still enums.
 */
export const GET = withAuth(async () => {
  const [departments, requestCategories, lookups] = await Promise.all([
    prisma.department.findMany({ select: { id: true, code: true, name: true, headId: true }, orderBy: { name: "asc" } }),
    prisma.requestCategory.findMany({
      select: { id: true, code: true, name: true, handlingDepartmentId: true },
      orderBy: { name: "asc" },
    }),
    loadLookups(),
  ]);
  return NextResponse.json({
    departments,
    requestCategories,
    roles: lookups.roles,
    countries: lookups.countries,
    userStatuses: lookups.statuses,
    enums: {
      requestPriorities: values(RequestPriority),
      requestStatuses: values(RequestStatus),
      ownerTypes: values(OwnerType),
      onboardingTaskStatuses: values(OnboardingTaskStatus),
    },
  });
});
