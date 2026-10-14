// apps/web/src/api/client.ts - Typed API client for JobPilot API
const BASE = "http://127.0.0.1:4000/api/v1";

export function getApiToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("jobpilot_token") || (window as unknown as { __TOKEN__?: string }).__TOKEN__ || "";
}

export function setApiToken(token: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("jobpilot_token", token);
  }
}

export async function apiClient<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getApiToken();
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && !(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("x-jobpilot-token", token);
  }

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(errorData.error?.message || `HTTP error ${res.status}`);
  }

  if (res.status === 204) {
    return null as T;
  }

  return res.json() as Promise<T>;
}
