import { useSyncExternalStore } from "react";

/**
 * Whether the backend could be reached by the last call. Set by `api()` when the backend is down
 * (network failure, 502/503/504, or a 5xx that is not the backend's own error envelope) and cleared by the next good response.
 */
let unavailable = false;
const listeners = new Set<() => void>();

export function setServiceUnavailable(value: boolean) {
  if (unavailable === value) return;
  unavailable = value;
  listeners.forEach((l) => l());
}

export function useServiceUnavailable(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => unavailable,
    () => false,
  );
}
