# Pattern: New Vue Page

## Steps

1. **Create the view** in `src/views/`:
   ```vue
   <script setup lang="ts">
   import { ref, onMounted } from 'vue'
   import { useMyFeature } from '@/composables/useMyFeature'

   const { items, isLoading, error, fetchItems } = useMyFeature()

   onMounted(() => fetchItems())
   </script>

   <template>
     <div class="container mx-auto p-4">
       <h1 class="text-2xl font-bold mb-4">My Page</h1>

       <div v-if="isLoading">Loading...</div>
       <div v-else-if="error" class="text-red-500">{{ error }}</div>
       <div v-else>
         <!-- Content here -->
       </div>
     </div>
   </template>
   ```

2. **Create the composable** in `src/composables/`:
   ```typescript
   export function useMyFeature() {
     const items = ref<Item[]>([])
     const isLoading = ref(false)
     const error = ref<string | null>(null)

     async function fetchItems() {
       isLoading.value = true
       error.value = null
       try {
         const res = await fetch('/api/my-feature')
         if (!res.ok) throw new Error('Failed')
         items.value = await res.json()
       } catch (e) {
         error.value = e instanceof Error ? e.message : 'Unknown error'
       } finally {
         isLoading.value = false
       }
     }

     return { items, isLoading, error, fetchItems }
   }
   ```

3. **Add the route** in `src/router/index.ts`:
   ```typescript
   {
     path: '/my-feature',
     component: () => import('@/views/MyFeatureView.vue'),
   }
   ```

4. **Handle states**: Always show loading, error, and empty states.
5. **Lazy-load**: Use dynamic imports for routes to keep bundle small.
