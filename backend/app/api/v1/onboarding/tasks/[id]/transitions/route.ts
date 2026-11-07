import { NextResponse } from "next/server";
import { parse, readJson } from "@/lib/validation";
import { withAuth } from "@/lib/with-auth";
import { taskTransitionBody, transitionTask } from "@/services/onboarding";

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { action } = parse(taskTransitionBody, await readJson(req));
  return NextResponse.json(await transitionTask(user, (await params).id, action));
});
