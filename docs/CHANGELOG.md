# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-02-23

First public release. A complete RAG-powered onboarding system with MCP integration for Claude Code.

### Core

- **Mastra AI agent** with 7 specialized RAG tools, anti-hallucination guardrails, and semantic memory
- **MCP server** (stdio transport) exposing all 7 tools for Claude Code integration
- **Vue 3 chat UI** with SSE streaming, markdown rendering, and syntax highlighting
- **Nightly pipeline** — incremental reindex, code review against conventions, test suggestion generation

### RAG Pipeline

- **Language-aware code chunking** — Java methods, TypeScript exports, Vue SFC sections, SQL statements (max 3000 chars)
- **Embeddings** via OpenRouter (`qwen/qwen3-embedding-8b`, 1024 dimensions, MTEB Code 80.68)
- **LLM-based reranking** on all 6 Qdrant tools (2x over-fetch, semantic + vector + position weights)
- **6 Qdrant collections** — standards, code-chunks, architecture, schemas, reviews, test-suggestions
- **Stale vector cleanup** — deletes vectors for deleted files and purges line-level vectors for modified files before re-upserting
- **Secret redaction** — strips API keys, connection strings, bearer tokens, AWS keys, and private keys before embedding

### MCP Tools

- `searchStandards` — coding conventions with category filter (backend, frontend, database, integration)
- `searchCode` — source code with language filter and 20-value layer enum matching chunker patterns
- `getArchitecture` — system architecture docs with area filter (8 areas)
- `searchSchemas` — database table documentation with tableName filter
- `searchReviews` — nightly review insights with severity and category filters
- `getTestSuggestions` — AI-generated test scaffolds with language filter
- `getPattern` — code templates (list available or get by name, with path traversal protection)
- All tools include **cross-tool disambiguation** in descriptions and **recovery guidance** on empty results

### Security

- **httpOnly cookie JWT** (HS256) — tokens never touch JavaScript (no localStorage)
- **Refresh token rotation** — 1-hour access tokens + 7-day refresh tokens with Redis-backed jti revocation
- **DOMPurify** sanitization on all rendered markdown
- **Rate limiting** — global (100/min), auth (10/15min), chat (20/min per user)
- **Secret redaction** before all embedding and LLM calls
- **CODEBASE_BRANCH regex** validation prevents git argument injection
- **bcrypt** password hashing with timing-safe comparison

### Infrastructure

- **Hono** HTTP server with structured logging (Pino)
- **PostgreSQL 17** + Drizzle ORM (users, conversations, messages)
- **Redis** for rate limiting, job queues, refresh token revocation, and indexing state
- **BullMQ** background jobs with nightly cron (2 AM)
- **Langfuse** self-hosted LLM observability
- **Docker Compose** — 6 services, multi-stage builds, healthchecks, non-root production images
- **pnpm workspace** monorepo (backend + frontend)

### Testing

- **119 tests** (89 backend + 30 frontend), all with mocks — no external services needed
- Backend: RAG tools (24), auth flows (9), SSE streaming (9), admin routes (5), code chunker (14), secret redaction (9), env validation (9), request validation (10)
- Frontend: auth store (7), chat store (6), rate-limit store (4), ChatMessage (5), ChatInput (4), AuthView (4)

### Documentation

- `CLAUDE.md` — full Claude Code configuration (architecture, commands, patterns, gotchas)
- `README.md` — comprehensive setup guide with Mermaid diagrams
- `docs/CONTRIBUTING.md` — development setup, code style, PR process
- `docs/FUTURE_IMPROVEMENTS.md` — roadmap (onboarding intelligence, convention guardian, remote codebase)
- `standards/` — sample knowledge base for quick start
