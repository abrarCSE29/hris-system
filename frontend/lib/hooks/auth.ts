"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/api";
import type { MeResponse, User } from "@/lib/types";

export const ME_KEY = ["me"] as const;

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: () => api<MeResponse>("/auth/me"), staleTime: 60_000 });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (creds: { email: string; password: string }) =>
      api<{ user: User }>("/auth/login", { method: "POST", body: creds }),
    // Every sign-in failure is a toast; the form itself shows no error. A 401 here means wrong credentials, not an
    // expired session, so it gets its own wording.
    meta: { failure: (e: unknown) => (e instanceof ApiClientError && e.status === 401 ? "Incorrect email or password." : undefined) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    onSettled: () => {
      qc.clear();
      window.location.assign("/login");
    },
  });
}
