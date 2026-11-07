import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getInstanceDetail } from "@/services/onboarding";

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) =>
  NextResponse.json(await getInstanceDetail(user, (await params).id)),
);
