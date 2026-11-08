"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DepartmentBreakdown } from "@/lib/departments";

export function useDepartmentBreakdown() {
  return useQuery({
    queryKey: ["departments", "breakdown"],
    queryFn: () => api<DepartmentBreakdown>("/departments/breakdown"),
    staleTime: 30_000,
    retry: false,
  });
}
