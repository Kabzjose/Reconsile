// Thin fetch wrapper: attaches the bearer token, throws a typed ApiError with the server's
// { error: { code, message, details } } shape, and gives every module (auth, orders, payments,
// ...) the same handful of typed helpers instead of re-implementing fetch everywhere.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  code: string;
  details?: unknown;
  status: number;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let currentToken: string | null = null;

/** Called once by AuthProvider on mount/login/logout; every request reads this. */
export function setAuthToken(token: string | null) {
  currentToken = token;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions["query"]) {
  const url = new URL(API_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (currentToken) headers.Authorization = `Bearer ${currentToken}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const error = json?.error ?? { code: "UNKNOWN", message: `Request failed (${res.status})` };
    throw new ApiError(res.status, error.code, error.message, error.details);
  }
  return json as T;
}

export const api = {
  get: <T,>(path: string, query?: RequestOptions["query"]) => apiFetch<T>(path, { query }),
  post: <T,>(path: string, body?: unknown) => apiFetch<T>(path, { method: "POST", body: body ?? {} }),
  patch: <T,>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PATCH", body: body ?? {} }),
};
