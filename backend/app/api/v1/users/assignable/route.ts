import { NextResponse } from "next/server";
import { z } from "zod";
import { parse } from "@/lib/validation";
import { withAuth } from "@/lib/with-auth";
import { queryObject, listAssignable } from "@/services/users";

const query = z.object({ departmentId: z.uuid() });

export const GET = withAuth(
  async (req, { user }) => {
    const { departmentId } = parse(query, queryObject(new URL(req.url).searchParams));
    return NextResponse.json(await listAssignable(user, departmentId));
  },
  { roles: ["MANAGER", "HR_ADMIN"] },
);
