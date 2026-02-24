// lib/api.ts — Authenticated fetch wrapper.
// Uses httpOnly cookies (credentials: include) and handles 401 + 429 responses.

import { toast } from "vue-sonner";

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

/** Attempt silent token refresh. Returns true if refresh succeeded. */
async function silentRefresh(): Promise<boolean> {
  if (isRefreshing && refreshPromise) return refreshPromise;

  isRefreshing = true;
  refreshPromise = fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
  })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      isRefreshing = false;
      refreshPromise = null;
    });

  return refreshPromise;
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...options, credentials: "include" });

  if (res.status === 401) {
    // Try silent refresh before giving up
    const refreshed = await silentRefresh();
    if (refreshed) {
      return fetch(url, { ...options, credentials: "include" });
    }

    // Refresh failed — clear session and redirect
    const { useAuthStore } = await import("@/stores/auth");
    const authStore = useAuthStore();
    authStore.clearSession();
    window.location.href = "/auth";
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After");
    const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : 60;
    toast.warning(`Rate limited. Try again in ${seconds}s.`);

    // Activate the rate-limit countdown UI so ChatInput disables itself
    const { useRateLimitStore } = await import("@/stores/rate-limit");
    const rateLimitStore = useRateLimitStore();
    rateLimitStore.setRateLimit(seconds);
  }

  return res;
}
