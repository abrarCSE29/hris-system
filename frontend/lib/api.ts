import { setServiceUnavailable } from "@/lib/service-status";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    /** The backend's id for this request (also its `x-request-id` header); quote it when reporting a problem. */
    readonly requestId?: string,
  ) {
    super(message);
  }
}

interface Options {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

/**
 * Calls the backend through the same-origin /api rewrite (cookie is sent automatically).
 * Throws ApiClientError for non-2xx responses, using the backend's error envelope.
 */
export async function api<T>(path: string, { method = "GET", body }: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    setServiceUnavailable(true);
    throw new ApiClientError(503, "SERVICE_UNAVAILABLE", "Service unavailable. Please try again later.");
  }

  if (res.status === 204) {
    setServiceUnavailable(false);
    return undefined as T;
  }
  const data = await res.json().catch(() => null);

  // The backend is down when the proxy answers 502/503/504, or a 5xx that is not the backend's own error envelope.
  if (res.status === 502 || res.status === 503 || res.status === 504 || (res.status >= 500 && !data?.error)) {
    setServiceUnavailable(true);
    throw new ApiClientError(503, "SERVICE_UNAVAILABLE", "Service unavailable. Please try again later.");
  }
  setServiceUnavailable(false);

  if (!res.ok) {
    // Session missing or expired: send the user to the login page (but not while logging in).
    if (res.status === 401 && path !== "/auth/login" && typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.assign("/login");
    }
    const err = data?.error;
    throw new ApiClientError(res.status, err?.code ?? "UNKNOWN", err?.message ?? `Request failed (${res.status})`, err?.details, err?.requestId);
  }
  return data as T;
}
