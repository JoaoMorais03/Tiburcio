// router/index.ts — Vue Router configuration with auth guard using Pinia store.

import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "chat",
      component: () => import("@/views/ChatView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/chat/:id",
      name: "chat-conversation",
      component: () => import("@/views/ChatView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/chats",
      name: "chats",
      component: () => import("@/views/ChatsView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/auth",
      name: "auth",
      component: () => import("@/views/AuthView.vue"),
      meta: { requiresAuth: false },
    },
  ],
});

router.beforeEach((to) => {
  const authStore = useAuthStore();

  if (to.meta.requiresAuth !== false && !authStore.isAuthenticated) {
    return { name: "auth" };
  }

  if (to.name === "auth" && authStore.isAuthenticated) {
    return { name: "chat" };
  }
});

export default router;
