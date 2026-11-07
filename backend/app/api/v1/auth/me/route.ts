import { NextResponse } from "next/server";
import { publicUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/with-auth";

export const GET = withAuth(async (_req, { user }) => {
  const active = await prisma.onboardingInstance.count({
    where: { employeeId: user.id, status: "ACTIVE" },
  });
  return NextResponse.json({
    user: publicUser(user),
    isNewHire: active > 0,
    headOfDepartmentId: user.headOfDepartmentId,
  });
});
