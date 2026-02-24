// __tests__/stores/auth.test.ts — Auth store tests (httpOnly cookie auth).

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "@/stores/auth";

describe("Auth Store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts unauthenticated when no stored user", () => {
    const store = useAuthStore();
    expect(store.isAuthenticated).toBe(false);
    expect(store.user).toBeNull();
  });

  it("logs in successfully with valid credentials", async () => {
    const store = useAuthStore();
    const result = await store.login("testuser", "password");

    expect(result.ok).toBe(true);
    expect(store.isAuthenticated).toBe(true);
    expect(store.user?.username).toBe("testuser");
    // Token is in httpOnly cookie, NOT in localStorage
    expect(localStorage.getItem("user")).not.toBeNull();
  });

  it("returns error for invalid credentials", async () => {
    const store = useAuthStore();
    const result = await store.login("wrong", "wrong");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid credentials");
    expect(store.isAuthenticated).toBe(false);
  });

  it("registers a new user", async () => {
    const store = useAuthStore();
    const result = await store.register("newuser", "password");

    expect(result.ok).toBe(true);
    expect(store.isAuthenticated).toBe(true);
    expect(store.user?.username).toBe("newuser");
  });

  it("returns error for existing username", async () => {
    const store = useAuthStore();
    const result = await store.register("existing", "password");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Registration failed");
  });

  it("clears state on logout", async () => {
    const store = useAuthStore();
    await store.login("testuser", "password");
    expect(store.isAuthenticated).toBe(true);

    await store.logout();

    expect(store.isAuthenticated).toBe(false);
    expect(store.user).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  });

  it("clears session without redirect", async () => {
    const store = useAuthStore();
    await store.login("testuser", "password");

    store.clearSession();

    expect(store.isAuthenticated).toBe(false);
    expect(localStorage.getItem("user")).toBeNull();
  });
});
