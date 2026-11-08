"use client";

import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ChatDraft } from "@/lib/types";

/** Asks the assistant to fill in the request form from one message. Nothing is saved; a failure is announced as a toast. */
export function useChatDraft() {
  return useMutation({
    mutationFn: (body: { message: string; page: string }) => api<ChatDraft>("/requests/chat-draft", { method: "POST", body }),
  });
}
