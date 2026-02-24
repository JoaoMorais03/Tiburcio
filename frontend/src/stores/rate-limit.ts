// stores/rate-limit.ts — Rate-limit tracking for chat input.

import { defineStore } from "pinia";
import { ref } from "vue";

export const useRateLimitStore = defineStore("rate-limit", () => {
  const isRateLimited = ref(false);
  const retryAfter = ref(0);

  function setRateLimit(retryAfterSeconds: number): void {
    isRateLimited.value = true;
    retryAfter.value = retryAfterSeconds;

    const interval = setInterval(() => {
      retryAfter.value--;
      if (retryAfter.value <= 0) {
        isRateLimited.value = false;
        retryAfter.value = 0;
        clearInterval(interval);
      }
    }, 1000);
  }

  return {
    isRateLimited,
    retryAfter,
    setRateLimit,
  };
});
