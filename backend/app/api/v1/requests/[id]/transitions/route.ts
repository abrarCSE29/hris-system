import { NextResponse } from "next/server";
import { parse, readJson } from "@/lib/validation";
import { withAuth } from "@/lib/with-auth";
import { transitionBody, transitionRequest } from "@/services/requests";

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { id } = await params;
  const body = parse(transitionBody, await readJson(req));
  return NextResponse.json(await transitionRequest(user, id, body));
});
