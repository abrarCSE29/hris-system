import { NextResponse } from "next/server";
import { parse } from "@/lib/validation";
import { withAuth } from "@/lib/with-auth";
import { getTeamDashboard, teamQuery } from "@/services/team-dashboard";
import { queryObject } from "@/services/users";

export const GET = withAuth(
  async (req, { user }) => {
    const { days } = parse(teamQuery, queryObject(new URL(req.url).searchParams));
    return NextResponse.json(await getTeamDashboard(user, days));
  },
  { roles: ["MANAGER"] },
);
