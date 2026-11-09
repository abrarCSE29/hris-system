"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ChatDraft, Paginated, RequestSummary } from "@/lib/types";

/** Asks the assistant to fill in the request form from one message. Nothing is saved; a failure is announced as a toast. */
export function useChatDraft() {
  return useMutation({
    mutationFn: (body: { message: string; page: string }) => api<ChatDraft>("/requests/chat-draft", { method: "POST", body }),
  });
}

/**
 * The person's own earlier requests that were raised through the assistant, newest first (at most 20). Loaded when the panel is
 * open and again each time it opens, so statuses are current. The key starts with "requests", so submitting a request refreshes it.
 */
export function useChatRequests(enabled: boolean) {
  return useQuery({
    queryKey: ["requests", "chat-history"],
    queryFn: () => api<Paginated<RequestSummary>>("/requests?mine=true&channel=CHAT&pageSize=20"),
    enabled,
    staleTime: 0,
  });
}
