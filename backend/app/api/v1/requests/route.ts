import { NextResponse } from "next/server";
import { parsePaging } from "@/lib/pagination";
import { parse, readJson } from "@/lib/validation";
import { withAuth } from "@/lib/with-auth";
import { createRequest, createRequestBody, listRequests, listRequestsQuery } from "@/services/requests";
import { queryObject } from "@/services/users";

export const GET = withAuth(async (req, { user }) => {
  const params = new URL(req.url).searchParams;
  const query = parse(listRequestsQuery, queryObject(params));
  return NextResponse.json(await listRequests(user, query, parsePaging(params)));
});

export const POST = withAuth(async (req, { user }) => {
  const body = parse(createRequestBody, await readJson(req));
  return NextResponse.json(await createRequest(user, body), { status: 201 });
});
