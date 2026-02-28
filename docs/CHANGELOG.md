# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.0.0] - 2026-02-28

Strategic pivot from "onboarding chatbot" to **Developer Intelligence MCP** — a codebase intelligence layer that makes Claude Code better at working with your specific codebase.

### Features

- **Local model support (Ollama)** — zero external API calls, <3s response times. Provider-agnostic architecture via `@ai-sdk/openai-compatible`. Set `MODEL_PROVIDER=ollama` and run with `docker compose --profile ollama up -d`.
- **Compact mode on all tools** — every tool now defaults to `compact: true`, returning 300-1,500 token responses (3 results, summaries only) instead of 2,000-8,000 tokens. Full mode still available via `compact: false`.
- **`getNightlySummary` tool** — consolidated morning briefing from the nightly intelligence pipeline. Returns merge count, severity breakdown, critical items, warning files, and test gaps in a single call.
- **Provider-agnostic model layer** — `infra.ts` centralizes all model creation. Switching providers is a single env var change, no code modifications.

### Architecture

- **`MODEL_PROVIDER` env var** — `openrouter` (cloud) or `ollama` (local inference)
- **`EMBEDDING_DIMENSIONS` auto-detection** — 768 for Ollama's `nomic-embed-text`, 4096 for OpenRouter's `qwen3-embedding-8b`
- **Centralized model creation** — `chatModel` and `embeddingModel` exported from `infra.ts`, imported by all consumers
- **Docker Compose Ollama profile** — `docker compose --profile ollama up -d` starts local inference with 8G memory limit

### New Files

| File | Purpose |
|------|---------|
| `mastra/tools/get-nightly-summary.ts` | Morning briefing tool — severity counts, critical items, test gaps |

### Breaking Changes

- `OPENROUTER_API_KEY` is no longer required when `MODEL_PROVIDER=ollama`
- Embedding dimensions are now configurable (were hardcoded to 4096)
- Switching `MODEL_PROVIDER` triggers automatic Qdrant collection recreation (dimension change)

### Testing

- **136 backend tests** (was 132) — 4 new env validation tests for Ollama provider, dimension coercion, and conditional API key validation
- **30 frontend tests** — unchanged

---

## [1.2.1] - 2026-02-25

MCP performance optimization. Removes all query-time LLM calls (reranking + query expansion), adds payload truncation and MCP annotations. All 7 tools now respond in under 1.5 seconds.

### Performance

- **Removed LLM reranking** — Mastra `rerank()` via OpenRouter added 7-22s per tool call. Qdrant's built-in RRF fusion (dense + BM25 reciprocal rank fusion) provides adequate ranking without the latency cost.
- **Removed LLM query expansion** — `expandQuery()` called the LLM on every `searchCode` invocation to generate search variants, adding 7-18s per call. Contextual retrieval (index-time) + hybrid search (dense + BM25) already bridge terminology gaps, making query-time LLM expansion redundant.
- **Payload truncation** — all tool outputs now cap large text fields (`code`: 1500 chars, `classContext`: 800, `content`/`suggestion`: 1500-2000, `mergeMessage`: 300) to reduce Claude Code token processing overhead.
- **MCP annotations** — all 7 tools declare `readOnlyHint: true` and `openWorldHint: false` via Mastra's MCP annotation support, signaling safe read-only behavior to Claude Code.

### Removed

- `indexer/rerank.ts` — dead code after removing LLM reranking from all tools.
- `indexer/query-expand.ts` — dead code after removing LLM query expansion from searchCode.
- `__tests__/query-expand.test.ts` — tests for the removed query expansion.

### New Files

| File | Purpose |
|------|---------|
| `mastra/tools/truncate.ts` | Shared text truncation utility for tool output payloads |

### Testing

- **132 backend tests** (was 138) — removed 6 query expansion tests and the test file.
- **30 frontend tests** — unchanged

---

## [1.2.0] - 2026-02-24

Multi-repo codebase indexing. Replace single `CODEBASE_PATH` + `CODEBASE_BRANCH` with a unified `CODEBASE_REPOS` env var supporting multiple repositories.

### Features

- **Multi-repo indexing** — single env var `CODEBASE_REPOS` (`name:path:branch`, comma-separated) replaces `CODEBASE_PATH` + `CODEBASE_BRANCH`. All repos index into one `code-chunks` collection with a `repo` metadata field.
- **Per-repo isolation** — re-indexing one repo doesn't wipe others (delete-by-repo-filter). Per-repo HEAD SHA tracking in Redis (`tiburcio:codebase-head:{repoName}`).
- **Collision-safe chunk IDs** — `toUUID(repo:filePath:startLine)` prevents cross-repo ID collisions.
- **Qdrant payload index** on `repo` field for O(1) filtering.
- **searchCode repo filter** — optional `repo` parameter to search within a specific repository.
- **Nightly pipeline** handles all repos independently.

### Infrastructure

- **Per-file indexing pipeline** — `p-limit(3)` concurrency, data appears in Qdrant immediately per file (~20-50 min for 558 files).
- **Retry logic** — embedding and upsert operations retry up to 3 times with 1s delay on transient failures.
- **`.tibignore` support** — per-repo ignore file using glob patterns to exclude files from indexing.

### Testing

- **138 backend tests** (was 113) — 12 new `index-codebase.test.ts` tests covering per-file pipeline, retry logic, contextualization skip, header chunks, error handling, and HEAD SHA storage.

---

## [1.1.0] - 2026-02-23

Comprehensive RAG pipeline overhaul. Fixes broken retrieval, adopts 2025-2026 industry best practices.

### RAG Pipeline (Breaking — Full Reindex Required)

- **AST-based code chunking** — tree-sitter native bindings replace regex-based chunking for Java and TypeScript. Eliminates 31+ false positives per Java file from regex matching `if`/`switch`/`for`/`while` as methods. One language-agnostic recursive split algorithm (cAST/EMNLP 2025 inspired). Vue SFC sections split by regex, then `<script>` blocks AST-parsed with TypeScript grammar. SQL stays regex-based.
- **Contextual retrieval** — LLM generates 2-3 sentence context per chunk before embedding (Anthropic 2024 technique). Context prepended to embedding text so vectors capture both code AND semantic purpose. 49% fewer retrieval failures in benchmarks.
- **Parent-child chunk expansion** — each chunk stores `headerChunkId` pointing to its file's header chunk (imports, class declaration, fields). At query time, header chunks fetched via point lookup and included as `classContext` in results.
- **Query expansion** — LLM generates 2-3 alternative search queries before searching. Catches results using different terminology for the same concept. — *removed in v1.2.1*
- **Hybrid search (BM25 + vector)** — code-chunks collection now has dual vector spaces: dense (4096-dim cosine) + sparse BM25 (Qdrant IDF modifier). Queries use prefetch + RRF fusion via Qdrant Query API. Searching "OrderServiceImpl" now returns exact keyword matches alongside semantic results.
- **Rich chunk metadata** — `symbolName`, `parentSymbol`, `chunkType`, `annotations`, `chunkIndex`, `totalChunks`, `headerChunkId` stored per chunk. searchCode returns all metadata to the agent.

### Infrastructure

- **Raw Qdrant client** — `rawQdrant` (`@qdrant/js-client-rest`) added to `infra.ts` alongside existing Mastra wrapper. Used for sparse vectors, Query API (prefetch + RRF), and point retrieval.
- **Dockerfile** — added `python3`, `make`, `g++` to Alpine build stage for tree-sitter native bindings compilation.
- **New dependencies** — `tree-sitter@^0.22.4`, `tree-sitter-java@^0.23.5`, `tree-sitter-typescript@^0.23.2`, `@qdrant/js-client-rest@^1.17.0`

### Bug Fixes

- **Fragile JSON extraction** — nightly review now tries `JSON.parse()` first, then code fences, then bare regex (was: regex only)
- **Working memory** — chat agent now has actionable instructions to update working memory after each exchange
- **File skip logging** — unreadable files during indexing now logged at debug level (was: silently skipped)

### New Files

| File | Purpose |
|------|---------|
| `indexer/ast-chunker.ts` | Tree-sitter AST parsing, language-agnostic chunking |
| `indexer/bm25.ts` | BM25 tokenizer for sparse vectors (FNV-1a hashing) |
| `indexer/contextualize.ts` | Contextual retrieval — LLM context per chunk |
| `indexer/query-expand.ts` | Query expansion — LLM search variants — *removed in v1.2.1* |
| `__tests__/bm25.test.ts` | BM25 tokenizer tests (13 tests) |
| `__tests__/contextualize.test.ts` | Contextualization tests (8 tests) |
| `__tests__/query-expand.test.ts` | Query expansion tests (6 tests) — *removed in v1.2.1* |

### Testing

- **113 backend tests** (was 89) — 24 new tests covering BM25 tokenizer, query expansion, contextualization, and updated search-code hybrid search
- **30 frontend tests** — unchanged

---

## [1.0.0] - 2026-02-23

First public release. A complete RAG-powered onboarding system with MCP integration for Claude Code.

### Core

- **Mastra AI agent** with 7 specialized RAG tools, anti-hallucination guardrails, and semantic memory
- **MCP server** (stdio transport) exposing all 7 tools for Claude Code integration
- **Vue 3 chat UI** with SSE streaming, markdown rendering, and syntax highlighting
- **Nightly pipeline** — incremental reindex, code review against conventions, test suggestion generation

### RAG Pipeline

- **Language-aware code chunking** — Java methods, TypeScript exports, Vue SFC sections, SQL statements (max 3000 chars)
- **Embeddings** via OpenRouter (`qwen/qwen3-embedding-8b`, 4096 dimensions, MTEB Code 80.68)
- **LLM-based reranking** on all 6 Qdrant tools (2x over-fetch, semantic + vector + position weights) — *removed in v1.2.1*
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
- **CODEBASE_REPOS** branch names validated at parse time
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
