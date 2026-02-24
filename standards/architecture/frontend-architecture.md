area: frontend
keyFiles: frontend/src/main.ts, frontend/src/router/index.ts, frontend/src/stores/chat.ts, frontend/vite.config.ts

# Frontend Architecture

Vue 3 single-page application with Composition API, Pinia stores, and Tailwind CSS v4.

## Stack
- **Vue 3** with `<script setup>` syntax
- **Pinia** for state management
- **Vue Router** with auth guards
- **TanStack Vue Query** for server state caching
- **Tailwind CSS v4** via Vite plugin
- **Vite** build tool with auto-imports and component auto-registration

## Views
- `/auth` — Login/register form
- `/` — Chat view (new conversation)
- `/chat/:id` — Chat view (existing conversation)
- `/chats` — Conversation list

## Stores
- `auth` — User session, login/register/logout, JWT management
- `chat` — Conversations, messages, SSE streaming state
- `rate-limit` — Rate limit countdown tracking for chat input

## Communication
- **Streaming**: SSE via `POST /api/chat/stream` for real-time chat responses
- **REST**: Conversation CRUD, auth endpoints
- `authFetch()` wrapper handles token injection, 401 redirects, 429 rate limits

## Component Architecture
- `components/ui/` — Base UI components (Button, Input, Dialog, etc.)
- `components/ai-elements/` — Chat primitives (Conversation, Message, PromptInput)
- `components/chat/` — App-specific chat components (ChatWindow, ChatInput, ChatMessage)
- Views compose chat components, which compose ai-elements, which compose ui primitives

## Build
- Auto-imports: `vue`, `vue-router`, `pinia`, `@vueuse/core` APIs available without import
- Component auto-registration: `ui/` and `chat/` directories
- PWA support via `vite-plugin-pwa` (offline-capable, installable)
- Bundle analysis via `rollup-plugin-visualizer`
