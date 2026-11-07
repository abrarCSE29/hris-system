import { NextResponse } from "next/server";
import { parsePaging } from "@/lib/pagination";
import { parse, readJson } from "@/lib/validation";
import { withAuth } from "@/lib/with-auth";
import { createUser, createUserBody, listUsers, listUsersQuery, queryObject } from "@/services/users";

export const GET = withAuth(
  async (req, { user }) => {
    const params = new URL(req.url).searchParams;
    const query = parse(listUsersQuery, queryObject(params));
    return NextResponse.json(await listUsers(user, query, parsePaging(params)));
  },
  { roles: ["MANAGER", "HR_ADMIN"] },
);

export const POST = withAuth(
  async (req) => {
    const body = parse(createUserBody, await readJson(req));
    return NextResponse.json(await createUser(body), { status: 201 });
  },
  { roles: ["HR_ADMIN"] },
);
