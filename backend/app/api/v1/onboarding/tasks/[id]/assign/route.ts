import { NextResponse } from "next/server";
import { parse, readJson } from "@/lib/validation";
import { withAuth } from "@/lib/with-auth";
import { assignTask, assignTaskBody } from "@/services/onboarding";

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { assigneeId } = parse(assignTaskBody, await readJson(req));
  return NextResponse.json(await assignTask(user, (await params).id, assigneeId));
});
