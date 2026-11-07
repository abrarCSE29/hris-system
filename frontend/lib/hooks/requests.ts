"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { buildQuery } from "@/lib/query";
import type { Paginated, RequestAction, RequestComment, RequestDetail, RequestPriority, RequestSummary } from "@/lib/types";

export interface RequestFilters {
  status?: string;
  categoryId?: string;
  priority?: string;
  country?: string;
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

export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { categoryId: string; title: string; description: string; priority: RequestPriority }) =>
      api<RequestSummary>("/requests", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["requests"] }),
  });
}

export function useTransition(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { action: RequestAction; assigneeId?: string; note?: string }) =>
      api<RequestDetail>(`/requests/${id}/transitions`, { method: "POST", body }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["request", id] }),
  });
}
