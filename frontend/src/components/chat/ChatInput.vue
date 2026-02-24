<!-- ChatInput.vue — Grok-style pill-shaped input with submit and voice buttons. -->
<script setup lang="ts">
import { computed } from "vue";
import {
  PromptInput,
  PromptInputSpeechButton,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { useChatStore } from "@/stores/chat";
import { useRateLimitStore } from "@/stores/rate-limit";

const chatStore = useChatStore();
const rateLimitStore = useRateLimitStore();

const isDisabled = computed(() => chatStore.isStreaming || rateLimitStore.isRateLimited);

const placeholder = computed(() => {
  if (rateLimitStore.isRateLimited) {
    return `Rate limited. Retry in ${rateLimitStore.retryAfter}s...`;
  }
  return "What's on your mind?";
});

function handleSubmit(payload: { text: string }) {
  if (!payload.text.trim() || isDisabled.value) return;
  chatStore.sendMessage(payload.text);
}
</script>

<template>
  <PromptInput
    class="max-w-3xl mx-auto w-full rounded-2xl border border-border bg-muted/50 shadow-lg"
    @submit="handleSubmit"
  >
    <PromptInputTextarea
      :placeholder="placeholder"
      class="bg-transparent border-none focus:ring-0 min-h-12 text-sm"
      :disabled="isDisabled"
    />
    <div class="absolute bottom-2 right-2 flex items-center gap-1">
      <PromptInputSpeechButton class="size-8" />
      <PromptInputSubmit
        :status="chatStore.isStreaming ? 'streaming' : 'ready'"
      />
    </div>
  </PromptInput>
</template>
