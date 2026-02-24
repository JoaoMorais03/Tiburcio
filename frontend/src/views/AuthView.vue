<!-- AuthView.vue — Login and register page with tab toggle. -->
<script setup lang="ts">
import { LogIn, UserPlus } from "lucide-vue-next";
import { ref } from "vue";
import { useRouter } from "vue-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/stores/auth";

const router = useRouter();
const authStore = useAuthStore();

const mode = ref<"login" | "register">("login");
const username = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);

async function handleSubmit() {
  error.value = "";
  loading.value = true;

  const fn = mode.value === "login" ? authStore.login : authStore.register;
  const result = await fn(username.value, password.value);

  loading.value = false;

  if (result.ok) {
    router.push({ name: "chat" });
  } else {
    error.value = result.error || "Something went wrong";
  }
}

function toggleMode() {
  mode.value = mode.value === "login" ? "register" : "login";
  error.value = "";
}
</script>

<template>
  <div class="flex items-center justify-center min-h-screen bg-background px-4">
    <div class="w-full max-w-sm">
      <!-- Brand -->
      <div class="text-center mb-8">
        <h1 class="text-3xl font-bold text-foreground tracking-tight">
          Tiburcio
        </h1>
        <p class="text-sm text-muted-foreground mt-1">
          AI-powered codebase knowledge assistant
        </p>
      </div>

      <!-- Card -->
      <div class="rounded-xl border border-border bg-card p-6 shadow-lg">
        <!-- Tab toggle -->
        <div class="flex gap-1 mb-6 p-1 rounded-lg bg-muted">
          <button
            class="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-md transition-colors"
            :class="mode === 'login'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'"
            @click="mode = 'login'; error = ''"
          >
            <LogIn class="size-3.5" />
            Login
          </button>
          <button
            class="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-md transition-colors"
            :class="mode === 'register'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'"
            @click="mode = 'register'; error = ''"
          >
            <UserPlus class="size-3.5" />
            Register
          </button>
        </div>

        <!-- Form -->
        <form @submit.prevent="handleSubmit" class="flex flex-col gap-4">
          <div>
            <label class="text-sm font-medium text-foreground mb-1.5 block">
              Username
            </label>
            <Input
              v-model="username"
              type="text"
              placeholder="Enter username"
              autocomplete="username"
              required
            />
          </div>

          <div>
            <label class="text-sm font-medium text-foreground mb-1.5 block">
              Password
            </label>
            <Input
              v-model="password"
              type="password"
              :placeholder="mode === 'register' ? 'Min. 8 characters' : 'Enter password'"
              autocomplete="current-password"
              required
            />
          </div>

          <!-- Error -->
          <p v-if="error" class="text-sm text-destructive">
            {{ error }}
          </p>

          <Button type="submit" :disabled="loading" class="w-full">
            {{ loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account' }}
          </Button>
        </form>

        <!-- Toggle link -->
        <p class="text-center text-sm text-muted-foreground mt-4">
          <template v-if="mode === 'login'">
            Don't have an account?
            <button class="text-primary hover:underline" @click="toggleMode">
              Register
            </button>
          </template>
          <template v-else>
            Already have an account?
            <button class="text-primary hover:underline" @click="toggleMode">
              Login
            </button>
          </template>
        </p>
      </div>
    </div>
  </div>
</template>
