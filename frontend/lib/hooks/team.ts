"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { TeamDashboard } from "@/lib/team";

export function useTeamDashboard(days: number) {
  return useQuery({
    queryKey: ["team", days],
    queryFn: () => api<TeamDashboard>(`/dashboard/team?days=${days}`),
    staleTime: 30_000,
    retry: false,
    // Keep the old numbers on screen while the new period loads.
    placeholderData: keepPreviousData,
  });
}
