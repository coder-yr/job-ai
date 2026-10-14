// apps/web/src/api/client.ts - Typed API client for JobPilot API
const BASE = "http://127.0.0.1:4000/api/v1";

declare const __TOKEN__: string | undefined;

export function getApiToken(): string {
  if (typeof window === "undefined") return "";
  const stored = localStorage.getItem("jobpilot_token");
  if (stored && stored.trim().length >= 32) return stored.trim();

  // 1. From vite define __TOKEN__
  if (typeof __TOKEN__ !== "undefined" && __TOKEN__ && __TOKEN__.length >= 32) {
    localStorage.setItem("jobpilot_token", __TOKEN__);
    return __TOKEN__;
  }

  // 2. From import.meta.env
  const envToken = (import.meta as unknown as { env?: { VITE_API_TOKEN?: string } }).env?.VITE_API_TOKEN;
  if (envToken && envToken.length >= 32) {
    localStorage.setItem("jobpilot_token", envToken);
    return envToken;
  }

  // 3. From window global
  const winToken = (window as unknown as { __TOKEN__?: string }).__TOKEN__;
  if (winToken && winToken.length >= 32) {
    localStorage.setItem("jobpilot_token", winToken);
    return winToken;
  }

  return "";
}

export function setApiToken(token: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("jobpilot_token", token.trim());
  }
}

export async function apiClient<T>(path: string, init?: RequestInit): Promise<T> {
  let token = getApiToken();

  // If token is missing, prompt user once
  if (!token && typeof window !== "undefined") {
    const entered = window.prompt("JobPilot API Token required. Please enter your API_TOKEN from .env:");
    if (entered && entered.trim().length >= 32) {
      setApiToken(entered);
      token = entered.trim();
    }
  }

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
    if (res.status === 401 && typeof window !== "undefined") {
      const entered = window.prompt("Invalid or missing API Token. Please paste your 32+ char API_TOKEN from .env:");
      if (entered && entered.trim().length >= 32) {
        setApiToken(entered);
      }
    }
    throw new Error(errorData.error?.message || `HTTP error ${res.status}`);
  }

  if (res.status === 204) {
    return null as T;
  }

  return res.json() as Promise<T>;
}
