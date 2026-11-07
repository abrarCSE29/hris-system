import { NextResponse } from "next/server";
import { parse, readJson } from "@/lib/validation";
import { withAuth } from "@/lib/with-auth";
import { createTemplateBody, getTemplate, updateTemplate } from "@/services/templates";

export const GET = withAuth<{ id: string }>(
  async (_req, { params }) => NextResponse.json(await getTemplate((await params).id)),
  { roles: ["HR_ADMIN"] },
);

/** Replaces the template's name, description and tasks. Same body as create. */
export const PUT = withAuth<{ id: string }>(
  async (req, { params }) => {
    const { id } = await params;
    const body = parse(createTemplateBody, await readJson(req));
    return NextResponse.json(await updateTemplate(id, body));
  },
  { roles: ["HR_ADMIN"] },
);
