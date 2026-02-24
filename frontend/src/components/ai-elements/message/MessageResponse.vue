<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { BuiltinTheme, BundledLanguage } from 'shiki'
import { cn } from '@/lib/utils'
import DOMPurify from 'dompurify'
import { computed, useSlots } from 'vue'
import { Markdown } from 'vue-stream-markdown'
import 'vue-stream-markdown/index.css'

interface Props {
  content?: string
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const slots = useSlots()
const slotContent = computed<string | undefined>(() => {
  const nodes = slots.default?.()
  if (!Array.isArray(nodes)) {
    return undefined
  }
  let text = ''
  for (const node of nodes) {
    if (typeof node.children === 'string')
      text += node.children
  }
  return text || undefined
})

const md = computed(() =>
  DOMPurify.sanitize(slotContent.value ?? props.content ?? '', { USE_PROFILES: { html: true } }),
)

const shikiOptions = {
  theme: ['vitesse-dark', 'vitesse-dark'] as [BuiltinTheme, BuiltinTheme],
  langs: [
    'typescript', 'javascript', 'json', 'yaml', 'bash',
    'sql', 'vue', 'css', 'html', 'java', 'markdown', 'python', 'xml',
  ] as BundledLanguage[],
}

const codeOptions = {
  languageName: true,
  lineNumbers: false,
  maxHeight: '500px',
}
</script>

<template>
  <Markdown
    :content="md"
    :shiki-options="shikiOptions"
    :code-options="codeOptions"
    :class="
      cn(
        'size-full [&>*:first-child]:mt-0! [&>*:last-child]:mb-0!',
        props.class,
      )
    "
    v-bind="$attrs"
  />
</template>
