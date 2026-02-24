<!-- ChatView.vue — Chat page. Loads conversation from route param. -->
<script setup lang="ts">
import { watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ChatWindow from "@/components/chat/ChatWindow.vue";
import { useChatStore } from "@/stores/chat";

const route = useRoute();
const router = useRouter();
const chatStore = useChatStore();

// Load conversation from URL param
watch(
  () => route.params.id as string | undefined,
  (id) => {
    if (id) {
      chatStore.loadMessages(id);
    } else {
      chatStore.createConversation();
    }
  },
  { immediate: true },
);

// Update URL when a new conversation is created via sendMessage
watch(
  () => chatStore.activeConversationId,
  (id) => {
    if (id && route.name === "chat" && !route.params.id) {
      router.replace({ name: "chat-conversation", params: { id } });
    }
  },
);
</script>

<template>
  <ChatWindow />
</template>
