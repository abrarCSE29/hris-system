"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { buildQuery } from "@/lib/query";
import type { Paginated, RequestAction, RequestComment, RequestDetail, RequestPriority, RequestSummary } from "@/lib/types";

export interface RequestFilters {
  status?: string;
  categoryId?: string;
  priority?: string;
  countryId?: string;
  page?: number;
  pageSize?: number;
}

export function useRequests(filters: RequestFilters) {
  return useQuery({
    queryKey: ["requests", filters],
    queryFn: () => api<Paginated<RequestSummary>>(`/requests${buildQuery({ ...filters })}`),
    placeholderData: keepPreviousData,
  });
}

export function useRequest(id: string) {
  return useQuery({
    queryKey: ["request", id],
    queryFn: () => api<RequestDetail>(`/requests/${id}`),
    // A 404 means "not yours or not there"; retrying won't change it.
    retry: false,
  });
}

const REQUEST_ACTION_DONE: Record<RequestAction, string> = {
  assign: "Request assigned",
  start: "Work started",
  resolve: "Request marked resolved",
  close: "Request closed",
};

export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { categoryId: string; title: string; description: string; priority: RequestPriority; handlingDepartmentId?: string; channel?: "FORM" | "CHAT" }) =>
      api<RequestSummary>("/requests", { method: "POST", body }),
    meta: { success: (_v: never, r: RequestSummary) => `Request ${r.reference} submitted` },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["requests"] }),
  });
}

export function useTransition(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { action: RequestAction; assigneeId?: string; note?: string }) =>
      api<RequestDetail>(`/requests/${id}/transitions`, { method: "POST", body }),
    meta: { success: (v: { action: RequestAction }) => REQUEST_ACTION_DONE[v.action] },
    onSuccess: (detail) => {
      qc.setQueryData(["request", id], detail);
      qc.invalidateQueries({ queryKey: ["requests"] });
    },
    // After a 409 the screen may be stale (someone else acted); refresh it.
    onError: () => qc.invalidateQueries({ queryKey: ["request", id] }),
  });
}

export function useAddComment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api<RequestComment>(`/requests/${id}/comments`, { method: "POST", body: { body } }),
    meta: { success: "Comment posted" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["request", id] }),
  });
}
