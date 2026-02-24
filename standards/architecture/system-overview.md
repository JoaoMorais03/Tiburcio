area: overview
keyFiles: backend/src/server.ts, backend/src/mastra/index.ts, backend/src/jobs/queue.ts, frontend/src/main.ts

# System Overview

Tiburcio is an AI-powered onboarding knowledge system. It indexes a team's documentation, source code, and conventions into a vector database, then answers developer questions grounded in actual codebase knowledge. It operates in two modes: **day mode** (answering questions via chat UI and MCP) and **night mode** (automatically re-indexing changes, reviewing merges, and generating test suggestions).

## Architecture Layers

### Frontend (Vue 3 + Vite)
Single-page application with Pinia stores, Vue Router, and Tailwind CSS. Communicates with the backend via REST API and SSE (Server-Sent Events) for real-time chat streaming. Developers use this UI to ask onboarding questions and explore recent changes.

### Backend (Hono + Mastra)
HTTP server built with Hono. Hosts the Mastra AI agent with RAG tools, JWT authentication, rate limiting (Redis), and background job processing (BullMQ). Also exposes an MCP server (stdio) so Claude Code can query the same knowledge base.

### Nightly Pipeline (BullMQ + Mastra Workflows)
Scheduled jobs that run at 2 AM:
1. **Incremental re-indexing** — Only re-embeds files changed since the last run. Deletes stale vectors for removed/renamed files.
2. **Code review agent** — Reads yesterday's merges to develop, reviews them against the team's standards collection, stores review insights in Qdrant.
3. **Test suggestion engine** — Generates test scaffolds for new/changed code based on existing test patterns and team conventions. Stores as searchable suggestions (never auto-committed).
4. **Notification** — Posts a summary to the team channel (Slack/Discord webhook).

### Data Layer
- **PostgreSQL** — Users, conversations, messages (Drizzle ORM)
- **Qdrant** — Vector collections for standards, code chunks, architecture docs, database schemas, code reviews, and test suggestions
- **Redis** — Rate limiting state and BullMQ job queues

### External Services
- **OpenRouter** — Cloud LLM (`openai/gpt-5-nano`) and embeddings (`openai/text-embedding-3-small`, 1536 dimensions)
- **Langfuse** — LLM observability and tracing (optional, self-hosted)

## Communication Flow

### Day Mode (Chat / MCP)
1. User sends message via SSE stream or MCP tool call
2. Backend authenticates JWT, resolves conversation
3. Mastra agent receives message, decides which RAG tools to call
4. Tools query Qdrant vector collections using embedded search
5. Agent generates response grounded in retrieved context
6. Response streams back to frontend in real-time

### Night Mode (Nightly Pipeline)
1. BullMQ cron triggers at 2:00 AM
2. Incremental indexer diffs against last indexed commit SHA
3. Changed files are chunked, embedded, and upserted into Qdrant (stale vectors deleted first)
4. Code review agent processes merge commits from the last 24 hours
5. Review insights are embedded and stored in the `reviews` collection
6. Test suggestion agent generates scaffolds from reviewed diffs
7. Notification webhook fires with a summary

### Morning Workflow
When a developer arrives and asks (via MCP or chat UI) "let's write tests for yesterday's merges":
1. `searchReviews` retrieves review insights for recent merges
2. `getTestSuggestions` returns test scaffolds grounded in team conventions
3. `searchCode` finds existing test files as reference patterns
4. `searchStandards` checks team testing conventions
5. The developer (or Claude Code) uses this context to write tests that match the team's actual patterns
