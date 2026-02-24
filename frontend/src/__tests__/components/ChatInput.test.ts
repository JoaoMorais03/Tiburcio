// __tests__/components/ChatInput.test.ts — ChatInput component tests.

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import ChatInput from "@/components/chat/ChatInput.vue";
import { useChatStore } from "@/stores/chat";
import { useRateLimitStore } from "@/stores/rate-limit";

describe("ChatInput", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("renders with default placeholder", () => {
    const wrapper = mount(ChatInput);
    const textarea = wrapper.find("textarea");
    expect(textarea.attributes("placeholder")).toBe("What's on your mind?");
  });

  it("shows rate limit placeholder when rate limited", () => {
    const rateLimitStore = useRateLimitStore();
    rateLimitStore.isRateLimited = true;
    rateLimitStore.retryAfter = 30;

    const wrapper = mount(ChatInput);
    const textarea = wrapper.find("textarea");
    expect(textarea.attributes("placeholder")).toContain("Rate limited");
    expect(textarea.attributes("placeholder")).toContain("30");
  });

  it("disables input when streaming", () => {
    const chatStore = useChatStore();
    chatStore.isStreaming = true;

    const wrapper = mount(ChatInput);
    const textarea = wrapper.find("textarea");
    expect(textarea.attributes("disabled")).toBeDefined();
  });

  it("disables input when rate limited", () => {
    const rateLimitStore = useRateLimitStore();
    rateLimitStore.isRateLimited = true;
    rateLimitStore.retryAfter = 10;

    const wrapper = mount(ChatInput);
    const textarea = wrapper.find("textarea");
    expect(textarea.attributes("disabled")).toBeDefined();
  });
});
