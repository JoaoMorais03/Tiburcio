# Vue 3 Composition API

Tags: frontend, vue3, composition-api, typescript

## Script Setup

Always use `<script setup lang="ts">`. Never use Options API.

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

const props = defineProps<{
  title: string
  items: Item[]
}>()

const emit = defineEmits<{
  select: [item: Item]
  close: []
}>()

const searchQuery = ref('')
const filteredItems = computed(() =>
  props.items.filter(item =>
    item.name.toLowerCase().includes(searchQuery.value.toLowerCase())
  )
)
</script>
```

## State Management

- `ref()` / `reactive()` for local component state.
- Pinia stores for state shared across components.
- `computed()` for derived state — never duplicate logic.

## Composables

Extract reusable logic into composables (`use*.ts`):
- Must return reactive refs and functions.
- Handle loading/error state internally.
- API calls always go through composables, never directly in components.

## Performance

- Lazy-load routes and heavy components (bundle size matters at 1000+ users).
- Use `v-once` for static content.
- Use `shallowRef` when deep reactivity isn't needed.
