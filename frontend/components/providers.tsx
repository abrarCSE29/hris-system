"use client";

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ServiceUnavailableDialog } from "@/components/service-unavailable-dialog";
import { ApiClientError } from "@/lib/api";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Toast shown when the mutation succeeds. A function receives what was sent and what came back. */
      success?: string | ((variables: never, data: never) => string);
      /** Wording for a failure toast, when the server's message isn't the right one. Return undefined to keep it. */
      failure?: (error: unknown) => string | undefined;
    };
  }
}

/** The text of a failure toast: the server's message, or a field-errors hint when the form shows the details. */
export function failureMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (Array.isArray(error.details) && error.details.length > 0) return "Please check the highlighted fields.";
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

/**
 * Every action's outcome is announced as a toast (shadcn Sonner): success text comes from the mutation's
 * `meta.success`, failures show the server's message. Loading failures stay on the page, not in a toast.
 */
export function createQueryClient() {
  return new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (data, variables, _context, mutation) => {
        const success = mutation.meta?.success;
        const text = typeof success === "function" ? (success as (v: unknown, d: unknown) => string)(variables, data) : success;
        if (text) toast.success(text);
      },
      onError: (error, _variables, _context, mutation) => {
        // The "Service Unavailable" window is already showing; a toast on top would repeat it.
        if (error instanceof ApiClientError && error.code === "SERVICE_UNAVAILABLE") return;
        // A 401 on any other action is already sending the person to the sign-in page.
        if (error instanceof ApiClientError && error.status === 401 && !mutation.meta?.failure) return;
        toast.error(mutation.meta?.failure?.(error) ?? failureMessage(error));
      },
    }),
    defaultOptions: {
      queries: {
        // Don't retry client errors (401/403/404/422); they won't fix themselves.
        retry: (count, err) => !(err instanceof ApiClientError && err.status < 500) && count < 2,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster position="top-center" />
      <ServiceUnavailableDialog />
    </QueryClientProvider>
  );
}
