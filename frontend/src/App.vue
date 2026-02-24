<!-- App.vue — Root layout with Claude-style sidebar and main content area. -->
<script setup lang="ts">
import { useRegisterSW } from "virtual:pwa-register/vue";
import { History, LogOut, PanelLeft, PanelLeftClose, Plus, Trash2 } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import { Toaster, toast } from "vue-sonner";
import { useAuthStore } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";

const route = useRoute();
const router = useRouter();
const sidebarOpen = ref(true);
const historyPopoverOpen = ref(false);
let historyPopoverTimeout: ReturnType<typeof setTimeout> | null = null;

const authStore = useAuthStore();
const chatStore = useChatStore();

function showHistoryPopover() {
  if (historyPopoverTimeout) clearTimeout(historyPopoverTimeout);
  historyPopoverOpen.value = true;
}

function hideHistoryPopover() {
  historyPopoverTimeout = setTimeout(() => {
    historyPopoverOpen.value = false;
  }, 200);
}

// PWA update prompt
const { needRefresh, updateServiceWorker } = useRegisterSW();

onMounted(() => {
  if (authStore.isAuthenticated) {
    chatStore.loadConversations();
  }
});

// Show toast when a new version is available
watch(needRefresh, (needs) => {
  if (needs) {
    toast.info("New version available!", {
      action: { label: "Update", onClick: () => updateServiceWorker(true) },
      duration: Infinity,
    });
  }
});

function selectConversation(id: string) {
  router.push({ name: "chat-conversation", params: { id } });
}

function handleNewChat() {
  router.push({ name: "chat" });
}

function handleLogout() {
  authStore.logout();
  router.push({ name: "auth" });
}

const isChats = computed(() => route.name === "chats");
const recentConversations = computed(() => chatStore.conversations.slice(0, 10));
</script>

<template>
  <Toaster position="bottom-right" theme="dark" :rich-colors="true" />

  <div class="flex h-screen w-screen overflow-hidden">
    <!-- Sidebar (only when authenticated) -->
    <aside
      v-if="authStore.isAuthenticated"
      class="flex flex-col bg-sidebar border-r border-sidebar-border shrink-0 transition-all duration-200"
      :class="sidebarOpen ? 'w-64' : 'w-12'"
    >
      <!-- Expanded sidebar -->
      <template v-if="sidebarOpen">
        <!-- Brand + toggle -->
        <div class="flex items-center justify-between px-4 py-4">
          <h1 class="text-base font-semibold text-foreground tracking-tight">
            Tiburcio
          </h1>
          <button
            class="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
            @click="sidebarOpen = false"
          >
            <PanelLeftClose class="size-4" />
          </button>
        </div>

        <!-- New Chat button -->
        <div class="px-3 mb-2">
          <button
            class="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-sidebar-foreground rounded-lg hover:bg-sidebar-accent transition-colors"
            @click="handleNewChat"
          >
            <Plus class="size-4" />
            New chat
          </button>
        </div>

        <!-- History section -->
        <div class="flex-1 overflow-hidden flex flex-col">
          <div class="px-3 mb-1">
            <RouterLink
              to="/chats"
              class="flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors"
              :class="isChats
                ? 'text-foreground bg-sidebar-accent'
                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground'"
            >
              <History class="size-4" />
              History
            </RouterLink>
          </div>
          <div class="flex-1 overflow-y-auto px-2">
            <div
              v-for="conv in recentConversations"
              :key="conv.id"
              class="group flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg cursor-pointer transition-colors mb-0.5"
              :class="chatStore.activeConversationId === conv.id
                ? 'bg-sidebar-accent text-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground'"
              @click="selectConversation(conv.id)"
            >
              <span class="flex-1 truncate">
                {{ conv.title || "Untitled" }}
              </span>
              <button
                class="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-destructive transition-all"
                @click.stop="chatStore.deleteConversation(conv.id)"
              >
                <Trash2 class="size-3" />
              </button>
            </div>
            <RouterLink
              v-if="chatStore.conversations.length > 10"
              to="/chats"
              class="flex items-center justify-center px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              See all
            </RouterLink>
            <p
              v-if="chatStore.conversations.length === 0"
              class="px-3 py-4 text-xs text-muted-foreground text-center"
            >
              No conversations yet
            </p>
          </div>
        </div>

        <!-- User info + logout at bottom -->
        <div class="mt-auto border-t border-sidebar-border px-3 py-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-sm text-sidebar-foreground truncate">
                {{ authStore.user?.username }}
              </span>
            </div>
            <button
              class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
              title="Sign out"
              @click="handleLogout"
            >
              <LogOut class="size-4" />
            </button>
          </div>
        </div>
      </template>

      <!-- Collapsed icon rail -->
      <template v-else>
        <div class="flex flex-col items-center py-3 gap-1 h-full">
          <!-- Expand toggle -->
          <button
            class="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
            title="Expand sidebar"
            @click="sidebarOpen = true"
          >
            <PanelLeft class="size-5" />
          </button>

          <!-- New chat -->
          <button
            class="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
            title="New chat"
            @click="handleNewChat"
          >
            <Plus class="size-5" />
          </button>

          <!-- History with hover popover -->
          <div
            class="relative"
            @mouseenter="showHistoryPopover"
            @mouseleave="hideHistoryPopover"
          >
            <button
              class="p-2 rounded-md transition-colors"
              :class="historyPopoverOpen
                ? 'text-foreground bg-sidebar-accent'
                : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent'"
            >
              <History class="size-5" />
            </button>

            <!-- Floating history panel -->
            <Transition
              enter-active-class="transition duration-150 ease-out"
              enter-from-class="opacity-0 translate-x-1"
              enter-to-class="opacity-100 translate-x-0"
              leave-active-class="transition duration-100 ease-in"
              leave-from-class="opacity-100 translate-x-0"
              leave-to-class="opacity-0 translate-x-1"
            >
              <div
                v-if="historyPopoverOpen"
                class="absolute left-full top-0 ml-2 w-64 max-h-96 bg-sidebar border border-sidebar-border rounded-lg shadow-xl overflow-hidden flex flex-col z-50"
                @mouseenter="showHistoryPopover"
                @mouseleave="hideHistoryPopover"
              >
                <div class="px-4 py-3 border-b border-sidebar-border">
                  <span class="text-sm font-semibold text-foreground">History</span>
                </div>
                <div class="flex-1 overflow-y-auto py-1">
                  <div
                    v-for="conv in recentConversations"
                    :key="conv.id"
                    class="px-4 py-2 text-sm cursor-pointer transition-colors truncate"
                    :class="chatStore.activeConversationId === conv.id
                      ? 'bg-sidebar-accent text-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground'"
                    @click="selectConversation(conv.id); historyPopoverOpen = false"
                  >
                    {{ conv.title || "Untitled" }}
                  </div>
                  <p
                    v-if="recentConversations.length === 0"
                    class="px-4 py-3 text-xs text-muted-foreground text-center"
                  >
                    No conversations yet
                  </p>
                </div>
                <RouterLink
                  v-if="chatStore.conversations.length > 0"
                  to="/chats"
                  class="block px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground border-t border-sidebar-border transition-colors"
                  @click="historyPopoverOpen = false"
                >
                  See all
                </RouterLink>
              </div>
            </Transition>
          </div>

          <!-- Logout at bottom -->
          <button
            class="mt-auto p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
            title="Sign out"
            @click="handleLogout"
          >
            <LogOut class="size-5" />
          </button>
        </div>
      </template>
    </aside>

    <!-- Main content -->
    <div class="flex-1 flex flex-col min-w-0">
      <RouterView />
    </div>
  </div>
</template>
