import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getDepartmentBreakdown } from "@/services/departments";

export const GET = withAuth(async () => NextResponse.json(await getDepartmentBreakdown()), { roles: ["HR_ADMIN"] });
