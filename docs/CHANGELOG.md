# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-02-23

Comprehensive RAG pipeline overhaul. Fixes broken retrieval, adopts 2025-2026 industry best practices.

### RAG Pipeline (Breaking — Full Reindex Required)

- **AST-based code chunking** — tree-sitter native bindings replace regex-based chunking for Java and TypeScript. Eliminates 31+ false positives per Java file from regex matching `if`/`switch`/`for`/`while` as methods. One language-agnostic recursive split algorithm (cAST/EMNLP 2025 inspired). Vue SFC sections split by regex, then `<script>` blocks AST-parsed with TypeScript grammar. SQL stays regex-based.
- **Contextual retrieval** — LLM generates 2-3 sentence context per chunk before embedding (Anthropic 2024 technique). Context prepended to embedding text so vectors capture both code AND semantic purpose. 49% fewer retrieval failures in benchmarks.
- **Parent-child chunk expansion** — each chunk stores `headerChunkId` pointing to its file's header chunk (imports, class declaration, fields). At query time, header chunks fetched via point lookup and included as `classContext` in results.
- **Query expansion** — LLM generates 2-3 alternative search queries before searching. Catches results using different terminology for the same concept.
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
| `indexer/query-expand.ts` | Query expansion — LLM search variants |
| `__tests__/bm25.test.ts` | BM25 tokenizer tests (13 tests) |
| `__tests__/contextualize.test.ts` | Contextualization tests (5 tests) |
| `__tests__/query-expand.test.ts` | Query expansion tests (5 tests) |

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
