"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { buildQuery } from "@/lib/query";
import type { Assignable, Meta, Paginated, User } from "@/lib/types";

export interface UserFilters {
  search?: string;
  /** Ids of rows from the lookup lists in `useMeta()`. */
  countryId?: string;
  departmentId?: string;
  statusId?: string;
  roleId?: string;
  page?: number;
  pageSize?: number;
}

export function useUsers(filters: UserFilters, options: { enabled?: boolean } = {}) {
  return useQuery({
    enabled: options.enabled,
    queryKey: ["users", filters],
    queryFn: () => api<Paginated<User>>(`/users${buildQuery({ ...filters })}`),
    placeholderData: keepPreviousData,
  });
}

/** Departments, categories and enum values for dropdowns. Rarely changes. */
export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/meta"), staleTime: Infinity });
}

/** People who can be assigned a request of this department (HR Admin, or that department's head). */
export function useAssignable(departmentId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["assignable", departmentId],
    queryFn: () => api<{ data: Assignable[] }>(`/users/assignable${buildQuery({ departmentId })}`),
    enabled,
  });
}
