// __tests__/stores/chat.test.ts — Chat store tests.

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "@/stores/chat";

describe("Chat Store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("loads conversations from API", async () => {
    const store = useChatStore();
    await store.loadConversations();

    expect(store.conversations).toHaveLength(2);
    expect(store.conversations[0].title).toBe("Test conversation");
  });

  it("loads messages for a conversation", async () => {
    const store = useChatStore();
    await store.loadMessages("conv-1");

    expect(store.activeConversationId).toBe("conv-1");
    expect(store.messages).toHaveLength(2);
    expect(store.messages[0].role).toBe("user");
    expect(store.messages[1].role).toBe("assistant");
  });

  it("creates a new conversation (resets state)", () => {
    const store = useChatStore();
    store.activeConversationId = "conv-1";
    store.messages = [
      {
        id: "m1",
        conversationId: "conv-1",
        role: "user",
        content: "test",
        createdAt: new Date().toISOString(),
      },
    ];

    store.createConversation();

    expect(store.activeConversationId).toBeNull();
    expect(store.messages).toHaveLength(0);
    expect(store.streamingContent).toBe("");
  });

  it("sends a message and receives SSE response", async () => {
    const store = useChatStore();

    await store.sendMessage("Hello");

    // User message + assistant response from SSE stream
    expect(store.messages).toHaveLength(2);
    expect(store.messages[0].role).toBe("user");
    expect(store.messages[0].content).toBe("Hello");
    expect(store.messages[1].role).toBe("assistant");
    expect(store.messages[1].content).toBe("Hello world!");
    expect(store.isStreaming).toBe(false);
  });

  it("deletes a conversation", async () => {
    const store = useChatStore();
    await store.loadConversations();
    store.activeConversationId = "conv-1";

    await store.deleteConversation("conv-1");

    expect(store.activeConversationId).toBeNull();
    expect(store.messages).toHaveLength(0);
  });

  it("does not send empty messages", async () => {
    const store = useChatStore();
    await store.sendMessage("   ");

    expect(store.messages).toHaveLength(0);
  });
});
