// stores/chat.ts — Pinia chat store with SSE streaming and Vue Query caching.

import { defineStore } from "pinia";
import { ref } from "vue";
import { toast } from "vue-sonner";
import { authFetch } from "@/lib/api";
import { queryClient } from "@/lib/query";

interface Conversation {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export type { Conversation, Message };

const conversationsQueryFn = async (): Promise<Conversation[]> => {
  const res = await authFetch("/api/chat/conversations");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const messagesQueryFn = async (conversationId: string): Promise<Message[]> => {
  const res = await authFetch(`/api/chat/conversations/${conversationId}/messages`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

export const useChatStore = defineStore("chat", () => {
  const conversations = ref<Conversation[]>([]);
  const activeConversationId = ref<string | null>(null);
  const messages = ref<Message[]>([]);
  const isStreaming = ref(false);
  const streamingContent = ref("");
  const isLoadingMessages = ref(false);

  // --- Event handler ---

  function handleEvent(type: string, data: Record<string, unknown>): void {
    const convId = activeConversationId.value || "";

    switch (type) {
      case "conversation":
        activeConversationId.value = data.conversationId as string;
        break;
      case "token":
        streamingContent.value += data.token as string;
        break;
      case "error":
        messages.value.push(
          makeAssistantMessage(convId, (data.error as string) || "Something went wrong."),
        );
        isStreaming.value = false;
        break;
      case "done":
        messages.value.push(
          makeAssistantMessage(convId, streamingContent.value, data.messageId as string),
        );
        streamingContent.value = "";
        isStreaming.value = false;
        refreshConversations();
        break;
    }
  }

  function makeAssistantMessage(
    conversationId: string,
    content: string,
    id: string = crypto.randomUUID(),
  ): Message {
    return {
      id,
      conversationId,
      role: "assistant",
      content,
      createdAt: new Date().toISOString(),
    };
  }

  // --- SSE streaming ---

  function parseSSELines(lines: string[], currentEvent: string): string {
    let event = currentEvent;

    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith("data:")) continue;

      const jsonStr = line.slice(5).trim();
      if (!jsonStr) continue;

      try {
        handleEvent(event, JSON.parse(jsonStr));
      } catch {
        // Skip malformed JSON lines
      }
    }

    return event;
  }

  async function consumeSSEStream(response: Response): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      currentEvent = parseSSELines(lines, currentEvent);
    }
  }

  // --- API actions (Vue Query cached) ---

  async function loadConversations(): Promise<void> {
    try {
      conversations.value = await queryClient.fetchQuery({
        queryKey: ["conversations"],
        queryFn: conversationsQueryFn,
      });
    } catch {
      toast.error("Failed to load conversations");
    }
  }

  /** Invalidate cache and re-fetch (used after mutations like delete, new message). */
  async function refreshConversations(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    await loadConversations();
  }

  async function loadMessages(conversationId: string): Promise<void> {
    try {
      isLoadingMessages.value = true;
      activeConversationId.value = conversationId;
      messages.value = await queryClient.fetchQuery({
        queryKey: ["messages", conversationId],
        queryFn: () => messagesQueryFn(conversationId),
      });
    } catch {
      toast.error("Failed to load messages");
    } finally {
      isLoadingMessages.value = false;
    }
  }

  function createConversation(): void {
    activeConversationId.value = null;
    messages.value = [];
    streamingContent.value = "";
  }

  async function deleteConversation(id: string): Promise<void> {
    try {
      const res = await authFetch(`/api/chat/conversations/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (activeConversationId.value === id) {
        createConversation();
      }
      queryClient.removeQueries({ queryKey: ["messages", id] });
      await refreshConversations();
      toast.success("Conversation deleted");
    } catch {
      toast.error("Failed to delete conversation");
    }
  }

  async function sendMessage(content: string): Promise<void> {
    if (isStreaming.value || !content.trim()) return;

    isStreaming.value = true;
    streamingContent.value = "";

    messages.value.push({
      id: crypto.randomUUID(),
      conversationId: activeConversationId.value || "",
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    });

    try {
      const res = await authFetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversationId.value || undefined,
          message: content,
        }),
      });

      if (!res.ok) throw new Error(`Chat request failed: ${res.status}`);
      await consumeSSEStream(res);
    } catch {
      toast.error("Failed to send message");
      messages.value.push(
        makeAssistantMessage(
          activeConversationId.value || "",
          "Sorry, something went wrong. Please try again.",
        ),
      );
    } finally {
      if (isStreaming.value) {
        isStreaming.value = false;
        await refreshConversations();
      }
    }
  }

  return {
    conversations,
    activeConversationId,
    messages,
    isStreaming,
    isLoadingMessages,
    streamingContent,
    loadConversations,
    loadMessages,
    createConversation,
    deleteConversation,
    sendMessage,
  };
});
