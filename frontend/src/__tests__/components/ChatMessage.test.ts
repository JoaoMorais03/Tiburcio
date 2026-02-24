// __tests__/components/ChatMessage.test.ts — ChatMessage component tests.

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatMessage from "@/components/chat/ChatMessage.vue";

// Stub the markdown component to avoid shiki initialization
vi.mock("vue-stream-markdown", () => ({
  Markdown: {
    name: "Markdown",
    props: ["content"],
    template: '<div class="markdown-stub">{{ content }}</div>',
  },
}));

// Stub lucide icons
vi.mock("lucide-vue-next", () => ({
  Check: { template: "<span>check</span>" },
  ClipboardCopy: { template: "<span>copy</span>" },
  RefreshCw: { template: "<span>retry</span>" },
}));

describe("ChatMessage", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("renders user message as plain text", () => {
    const wrapper = mount(ChatMessage, {
      props: { role: "user", content: "Hello there" },
    });

    expect(wrapper.find("p.whitespace-pre-wrap").text()).toBe("Hello there");
    expect(wrapper.find(".markdown-stub").exists()).toBe(false);
  });

  it("renders assistant message with markdown component", () => {
    const wrapper = mount(ChatMessage, {
      props: { role: "assistant", content: "# Hello" },
    });

    expect(wrapper.find(".markdown-stub").exists()).toBe(true);
    expect(wrapper.find("p.whitespace-pre-wrap").exists()).toBe(false);
  });

  it("shows streaming cursor when isStreaming is true", () => {
    const wrapper = mount(ChatMessage, {
      props: { role: "assistant", content: "typing...", isStreaming: true },
    });

    expect(wrapper.find(".animate-pulse").exists()).toBe(true);
  });

  it("hides streaming cursor when not streaming", () => {
    const wrapper = mount(ChatMessage, {
      props: { role: "assistant", content: "done" },
    });

    expect(wrapper.find(".animate-pulse").exists()).toBe(false);
  });

  it("shows retry button only for assistant messages with messageId", () => {
    const withId = mount(ChatMessage, {
      props: { role: "assistant", content: "response", messageId: "msg-1" },
    });
    // Action buttons are hidden by default (opacity-0), but exist in DOM
    expect(withId.text()).toContain("Retry");

    const withoutId = mount(ChatMessage, {
      props: { role: "assistant", content: "response" },
    });
    expect(withoutId.text()).not.toContain("Retry");
  });
});
