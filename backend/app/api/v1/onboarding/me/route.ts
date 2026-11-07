import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getMyChecklist } from "@/services/onboarding";

/** The signed-in user's own checklist, or `null` if they have none. */
export const GET = withAuth(async (_req, { user }) => NextResponse.json(await getMyChecklist(user)));
