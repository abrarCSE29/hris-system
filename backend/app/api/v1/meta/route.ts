import { NextResponse } from "next/server";
import {
  Country, OnboardingTaskStatus, OwnerType, RequestPriority, RequestStatus, Role, UserStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/with-auth";

const values = <T extends Record<string, string>>(e: T) => Object.values(e);

/** Reference data for form dropdowns: departments, request categories and enum values. */
export const GET = withAuth(async () => {
  const [departments, requestCategories] = await Promise.all([
    prisma.department.findMany({ select: { id: true, code: true, name: true, headId: true }, orderBy: { name: "asc" } }),
    prisma.requestCategory.findMany({
      select: { id: true, code: true, name: true, handlingDepartmentId: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return NextResponse.json({
    departments,
    requestCategories,
    enums: {
      roles: values(Role),
      countries: values(Country),
      userStatuses: values(UserStatus),
      requestPriorities: values(RequestPriority),
      requestStatuses: values(RequestStatus),
      ownerTypes: values(OwnerType),
      onboardingTaskStatuses: values(OnboardingTaskStatus),
    },
  });
});
