// __tests__/stores/rate-limit.test.ts — Rate limit store tests.

import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRateLimitStore } from "@/stores/rate-limit";

describe("Rate Limit Store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts not rate limited", () => {
    const store = useRateLimitStore();
    expect(store.isRateLimited).toBe(false);
    expect(store.retryAfter).toBe(0);
  });

  it("sets rate limit with countdown", () => {
    const store = useRateLimitStore();
    store.setRateLimit(30);

    expect(store.isRateLimited).toBe(true);
    expect(store.retryAfter).toBe(30);
  });

  it("counts down retryAfter each second", () => {
    const store = useRateLimitStore();
    store.setRateLimit(3);

    vi.advanceTimersByTime(1000);
    expect(store.retryAfter).toBe(2);

    vi.advanceTimersByTime(1000);
    expect(store.retryAfter).toBe(1);
  });

  it("clears rate limit when countdown reaches zero", () => {
    const store = useRateLimitStore();
    store.setRateLimit(2);

    vi.advanceTimersByTime(2000);

    expect(store.isRateLimited).toBe(false);
    expect(store.retryAfter).toBe(0);
  });
});
