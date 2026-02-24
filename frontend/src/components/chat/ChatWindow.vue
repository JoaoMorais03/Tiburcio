<!-- ChatWindow.vue — Full chat interface with Grok-style centered empty state. -->
<script setup lang="ts">
import { computed } from "vue";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import { useChatStore } from "@/stores/chat";
import ChatInput from "./ChatInput.vue";
import ChatMessage from "./ChatMessage.vue";

const chatStore = useChatStore();

const hasConversation = computed(
  () =>
    chatStore.messages.length > 0 ||
    chatStore.streamingContent ||
    chatStore.isStreaming ||
    chatStore.isLoadingMessages,
);
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- Grok-style empty state: title + input centered -->
    <div
      v-if="!hasConversation"
      class="flex-1 flex flex-col items-center justify-center px-4"
    >
      <div class="text-center mb-8">
        <h2 class="text-3xl font-semibold text-foreground mb-3">Tiburcio</h2>
        <p class="text-muted-foreground text-base">
          Ask questions about your team's coding conventions,
          architecture decisions, and workflows.
        </p>
      </div>
      <div class="w-full max-w-3xl">
        <ChatInput />
      </div>
    </div>

    <!-- Active conversation: messages + input at bottom -->
    <template v-else>
      <Conversation class="flex-1 min-h-0">
        <ConversationContent class="max-w-3xl mx-auto w-full px-4">
          <ChatMessage
            v-for="msg in chatStore.messages"
            :key="msg.id"
            :role="msg.role"
            :content="msg.content"
            :message-id="msg.id"
          />
          <!-- Streaming response -->
          <ChatMessage
            v-if="chatStore.streamingContent"
            role="assistant"
            :content="chatStore.streamingContent"
            :is-streaming="true"
          />
          <!-- Thinking indicator: waiting for first token -->
          <div v-else-if="chatStore.isStreaming" class="flex items-start">
            <div class="flex items-center gap-1.5 py-2">
              <span class="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:0ms]" />
              <span class="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:150ms]" />
              <span class="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        </ConversationContent>
      </Conversation>

      <div class="shrink-0 pb-4 pt-2 px-4">
        <ChatInput />
      </div>
    </template>
  </div>
</template>
