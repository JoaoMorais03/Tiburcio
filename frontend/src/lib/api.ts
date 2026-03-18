// lib/api.ts — Authenticated fetch wrapper.
// Uses httpOnly cookies (credentials: include) and handles 401 + 429 responses.

import { toast } from "vue-sonner";

/** Read a cookie value by name from document.cookie. */
function getCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

/** Attempt silent token refresh. Returns true if refresh succeeded. */
async function silentRefresh(): Promise<boolean> {
  if (isRefreshing && refreshPromise) return refreshPromise;

  isRefreshing = true;
  const refreshCsrf = getCookie("csrf-token");
  refreshPromise = fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
    headers: refreshCsrf ? { "X-CSRF-Token": refreshCsrf } : undefined,
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
  const csrfToken = getCookie("csrf-token");
  const headers = new Headers(options.headers);
  if (csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const res = await fetch(url, { ...options, headers, credentials: "include" });

  if (res.status === 401) {
    // Try silent refresh before giving up
    const refreshed = await silentRefresh();
    if (refreshed) {
      // Re-read CSRF token — refresh response sets a new one
      const newCsrfToken = getCookie("csrf-token");
      const retryHeaders = new Headers(options.headers);
      if (newCsrfToken) {
        retryHeaders.set("X-CSRF-Token", newCsrfToken);
      }
      return fetch(url, { ...options, headers: retryHeaders, credentials: "include" });
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
