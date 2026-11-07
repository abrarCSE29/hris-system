import { NextResponse } from "next/server";
import { parse, readJson } from "@/lib/validation";
import { withAuth } from "@/lib/with-auth";
import { createTemplate, createTemplateBody, listTemplates } from "@/services/templates";

export const GET = withAuth(async () => NextResponse.json(await listTemplates()), { roles: ["HR_ADMIN"] });

export const POST = withAuth(
  async (req, { user }) => {
    const body = parse(createTemplateBody, await readJson(req));
    return NextResponse.json(await createTemplate(user, body), { status: 201 });
  },
  { roles: ["HR_ADMIN"] },
);
