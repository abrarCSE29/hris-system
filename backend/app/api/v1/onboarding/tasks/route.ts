import { NextResponse } from "next/server";
import { parsePaging } from "@/lib/pagination";
import { parse } from "@/lib/validation";
import { withAuth } from "@/lib/with-auth";
import { listTasks, listTasksQuery } from "@/services/onboarding";
import { queryObject } from "@/services/users";

export const GET = withAuth(async (req, { user }) => {
  const params = new URL(req.url).searchParams;
  const query = parse(listTasksQuery, queryObject(params));
  return NextResponse.json(await listTasks(user, query, parsePaging(params)));
});
