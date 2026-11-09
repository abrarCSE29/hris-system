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
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);

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
