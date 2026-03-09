# Pattern: New Vue Component

## Steps

1. **Create the component** in `frontend/src/components/`:
   ```vue
   <script setup lang="ts">
   import { computed } from 'vue'
   import { Button } from '@/components/ui/button'
   import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
   import { cn } from '@/lib/utils'

   interface Props {
     title: string
     description?: string
     variant?: 'default' | 'highlight'
   }

   const props = withDefaults(defineProps<Props>(), {
     variant: 'default',
   })

   const emit = defineEmits<{
     action: [id: string]
   }>()

   const cardClass = computed(() =>
     cn('rounded-lg border', {
       'border-primary bg-primary/5': props.variant === 'highlight',
     }),
   )
   </script>

   <template>
     <Card :class="cardClass">
       <CardHeader>
         <CardTitle>{{ title }}</CardTitle>
       </CardHeader>
       <CardContent>
         <p v-if="description" class="text-sm text-muted-foreground mb-4">
           {{ description }}
         </p>
         <slot />
         <Button class="mt-4" @click="emit('action', title)">
           Take Action
         </Button>
       </CardContent>
     </Card>
   </template>
   ```

2. **Use `cn()` for conditional classes** instead of ternary expressions in templates:
   ```typescript
   import { cn } from '@/lib/utils'

   const cardClass = computed(() =>
     cn('rounded-lg border', {
       'border-primary bg-primary/5': props.variant === 'highlight',
     }),
   )
   ```

3. **Handle loading and empty states** in the template:
   ```vue
   <template>
     <Skeleton v-if="isLoading" class="h-24 w-full" />
     <div v-else-if="items.length === 0" class="text-muted-foreground text-center py-8">
       No items found.
     </div>
     <div v-else class="space-y-4">
       <ItemCard v-for="item in items" :key="item.id" :item="item" />
     </div>
   </template>
   ```

## Conventions
- Use `<script setup lang="ts">` — no Options API
- Style exclusively with Tailwind v4 utility classes — no custom CSS, no inline styles
- Import UI components from `@/components/ui/` (shadcn-vue)
- Use `cn()` from `@/lib/utils` for conditional class merging
- Type props with `defineProps<Interface>()` and defaults with `withDefaults()`
- Type emits with `defineEmits<{ eventName: [argType] }>()`
- Always handle loading, error, and empty states
- Run `pnpm check && pnpm test` in `frontend/` before committing
