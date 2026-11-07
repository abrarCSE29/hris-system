import { NextResponse } from "next/server";
import { parsePaging } from "@/lib/pagination";
import { parse, readJson } from "@/lib/validation";
import { withAuth } from "@/lib/with-auth";
import { assignChecklist, createInstanceBody, listInstances, listInstancesQuery } from "@/services/onboarding";
import { queryObject } from "@/services/users";

export const GET = withAuth(
  async (req, { user }) => {
    const params = new URL(req.url).searchParams;
    const query = parse(listInstancesQuery, queryObject(params));
    return NextResponse.json(await listInstances(user, query, parsePaging(params)));
  },
  { roles: ["MANAGER", "HR_ADMIN"] },
);

export const POST = withAuth(
  async (req, { user }) => {
    const body = parse(createInstanceBody, await readJson(req));
    return NextResponse.json(await assignChecklist(user, body), { status: 201 });
  },
  { roles: ["HR_ADMIN"] },
);
