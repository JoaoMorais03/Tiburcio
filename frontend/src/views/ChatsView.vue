<!-- ChatsView.vue — Full chat history page, Claude-style list with timestamps. -->
<script setup lang="ts">
import { Search, Trash2 } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Input } from "@/components/ui/input";
import { useChatStore } from "@/stores/chat";

const router = useRouter();
const chatStore = useChatStore();

const search = ref("");

const filtered = computed(() => {
  const q = search.value.toLowerCase().trim();
  if (!q) return chatStore.conversations;
  return chatStore.conversations.filter((c) => (c.title || "").toLowerCase().includes(q));
});

function openChat(id: string) {
  router.push({ name: "chat-conversation", params: { id } });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  return date.toLocaleDateString();
}

onMounted(() => {
  chatStore.loadConversations();
});
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <div class="max-w-3xl mx-auto px-6 py-8">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-2xl font-semibold text-foreground">Chats</h2>
        <span class="text-sm text-muted-foreground">
          {{ chatStore.conversations.length }} conversation{{ chatStore.conversations.length !== 1 ? "s" : "" }}
        </span>
      </div>

      <!-- Search -->
      <div class="relative mb-6">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          v-model="search"
          type="text"
          placeholder="Search your chats..."
          class="pl-10"
        />
      </div>

      <!-- Chat list -->
      <div class="flex flex-col">
        <div
          v-for="conv in filtered"
          :key="conv.id"
          class="group flex items-center justify-between px-4 py-4 border-b border-border cursor-pointer hover:bg-muted/30 transition-colors"
          @click="openChat(conv.id)"
        >
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-foreground truncate">
              {{ conv.title || "Untitled" }}
            </p>
            <p class="text-xs text-muted-foreground mt-0.5">
              {{ formatDate(conv.updatedAt || conv.createdAt) }}
            </p>
          </div>
          <button
            class="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-muted-foreground hover:text-destructive transition-all ml-3 shrink-0"
            @click.stop="chatStore.deleteConversation(conv.id)"
          >
            <Trash2 class="size-3.5" />
          </button>
        </div>
      </div>

      <!-- Empty state -->
      <p
        v-if="filtered.length === 0 && search"
        class="text-center text-sm text-muted-foreground py-12"
      >
        No chats matching "{{ search }}"
      </p>
      <p
        v-else-if="chatStore.conversations.length === 0"
        class="text-center text-sm text-muted-foreground py-12"
      >
        No conversations yet. Start a new chat!
      </p>
    </div>
  </div>
</template>
