// stores/auth.ts — Pinia auth store. httpOnly cookie auth (no token in localStorage).

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { toast } from "vue-sonner";

interface UserInfo {
  id: string;
  username: string;
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref<UserInfo | null>(JSON.parse(localStorage.getItem("user") || "null"));

  const isAuthenticated = computed(() => !!user.value);

  async function login(
    username: string,
    password: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        const error = data.error || "Login failed";
        toast.error(error);
        return { ok: false, error };
      }

      localStorage.setItem("user", JSON.stringify(data.user));
      user.value = data.user;
      toast.success("Welcome back!");
      return { ok: true };
    } catch {
      toast.error("Network error");
      return { ok: false, error: "Network error" };
    }
  }

  async function register(
    username: string,
    password: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        const error = data.error || "Registration failed";
        toast.error(error);
        return { ok: false, error };
      }

      localStorage.setItem("user", JSON.stringify(data.user));
      user.value = data.user;
      toast.success("Account created!");
      return { ok: true };
    } catch {
      toast.error("Network error");
      return { ok: false, error: "Network error" };
    }
  }

  async function logout(): Promise<void> {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Server unreachable — clear locally anyway
    }
    localStorage.removeItem("user");
    user.value = null;
    toast.success("Signed out");
  }

  /** Called by api.ts on 401 — clears state without redirect */
  function clearSession(): void {
    localStorage.removeItem("user");
    user.value = null;
  }

  return {
    user,
    isAuthenticated,
    login,
    register,
    logout,
    clearSession,
  };
});
