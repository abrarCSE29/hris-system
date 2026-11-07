import { NextResponse } from "next/server";
import { parse, readJson } from "@/lib/validation";
import { withAuth } from "@/lib/with-auth";
import { addComment, commentBody } from "@/services/requests";

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { id } = await params;
  const body = parse(commentBody, await readJson(req));
  return NextResponse.json(await addComment(user, id, body), { status: 201 });
});
