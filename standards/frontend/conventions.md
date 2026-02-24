# Frontend Conventions

Our frontend is built with Vue 3 (Composition API) and TypeScript. Follow these conventions to keep our codebase consistent.

## Component Structure

Every Vue component follows this order:
1. `<script setup lang="ts">` block first
2. `<template>` block second
3. `<style scoped>` block last (if needed)

Use `defineProps` and `defineEmits` with TypeScript generics for type safety:
```vue
<script setup lang="ts">
const props = defineProps<{
  title: string
  count: number
}>()

const emit = defineEmits<{
  update: [value: number]
}>()
</script>
```

## Naming Conventions

- Components: PascalCase (`UserProfile.vue`, `ChatMessage.vue`)
- Composables: camelCase with `use` prefix (`useAuth.ts`, `useChat.ts`)
- Stores: camelCase with `Store` suffix (`userStore.ts`)
- CSS classes: kebab-case via Tailwind utility classes
- File names match the default export name

## State Management

We use composables (not Pinia) for state management in this project. Each composable returns reactive refs and functions:

```typescript
export function useCounter() {
  const count = ref(0)
  const increment = () => count.value++
  return { count, increment }
}
```

## API Calls

All API calls go through composables, never directly in components. Use native `fetch` — no Axios. Handle errors in the composable and expose loading/error state:

```typescript
const isLoading = ref(false)
const error = ref<string | null>(null)

async function fetchData() {
  isLoading.value = true
  error.value = null
  try {
    const res = await fetch('/api/data')
    if (!res.ok) throw new Error('Failed to fetch')
    return await res.json()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Unknown error'
  } finally {
    isLoading.value = false
  }
}
```

## Styling

We use Tailwind CSS v4. Avoid writing custom CSS unless absolutely necessary. Use the `cn()` utility from shadcn-vue for conditional classes. Never use inline styles.
