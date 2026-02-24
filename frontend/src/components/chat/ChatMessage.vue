<!-- ChatMessage.vue — Bubble-style chat message with markdown rendering and actions. -->
<script setup lang="ts">
import { Check, ClipboardCopy, RefreshCw } from "lucide-vue-next";
import { ref } from "vue";
import { toast } from "vue-sonner";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { useChatStore } from "@/stores/chat";

const props = defineProps<{
  role: "user" | "assistant";
  content: string;
  messageId?: string;
  isStreaming?: boolean;
}>();

const chatStore = useChatStore();
const copied = ref(false);

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(props.content);
    copied.value = true;
    toast.success("Copied!");
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    toast.error("Failed to copy");
  }
}

function handleRetry() {
  // Find the preceding user message and resend it
  const msgs = chatStore.messages;
  const idx = msgs.findIndex((m) => m.id === props.messageId);
  if (idx <= 0) return;

  const userMsg = msgs[idx - 1];
  if (userMsg?.role !== "user") return;

  // Remove this assistant message and resend
  chatStore.messages.splice(idx, 1);
  chatStore.sendMessage(userMsg.content);
}
</script>

<template>
  <Message :from="role" :class="role === 'assistant' ? 'max-w-full' : ''">
    <div class="flex flex-col min-w-0 w-full">
      <MessageContent :class="role === 'assistant' ? 'w-full' : ''">
        <!-- Markdown-rendered response for assistant, plain text for user -->
        <MessageResponse v-if="role === 'assistant'" :content="content" />
        <p v-else class="whitespace-pre-wrap">{{ content }}</p>

        <!-- Streaming cursor -->
        <span
          v-if="isStreaming"
          class="inline-block w-1.5 h-4 bg-muted-foreground animate-pulse ml-0.5 align-text-bottom rounded-sm"
        />
      </MessageContent>

      <!-- Message actions (assistant only, not during streaming) -->
      <div
        v-if="role === 'assistant' && !isStreaming && content"
        class="mt-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <button
          class="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded transition-colors"
          @click="handleCopy"
        >
          <Check v-if="copied" class="size-3" />
          <ClipboardCopy v-else class="size-3" />
          {{ copied ? "Copied" : "Copy" }}
        </button>
        <button
          v-if="messageId"
          class="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded transition-colors"
          @click="handleRetry"
        >
          <RefreshCw class="size-3" />
          Retry
        </button>
      </div>
    </div>
  </Message>
</template>
