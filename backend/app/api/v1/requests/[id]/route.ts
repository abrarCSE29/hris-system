import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getRequestDetail } from "@/services/requests";

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  const { id } = await params;
  return NextResponse.json(await getRequestDetail(user, id));
});
