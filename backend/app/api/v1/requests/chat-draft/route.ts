import { NextResponse } from "next/server";
import { parse, readJson } from "@/lib/validation";
import { withAuth } from "@/lib/with-auth";
import { chatDraftBody, createChatDraft, originOf } from "@/services/intake";

// The AI service may take up to ~20 s on a slow model call; give the platform's function limit room for it.
export const maxDuration = 60;

export const POST = withAuth(async (req, { user }) => {
  const body = parse(chatDraftBody, await readJson(req));
  return NextResponse.json(await createChatDraft(user, body, originOf(req)));
});
