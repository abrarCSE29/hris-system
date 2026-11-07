import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getDashboardSummary } from "@/services/dashboard";

export const GET = withAuth(async () => NextResponse.json(await getDashboardSummary()), { roles: ["HR_ADMIN"] });
