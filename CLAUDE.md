# Tiburcio — Claude Code Configuration

Developer intelligence MCP. Indexes team docs, source code, and conventions into Qdrant, then exposes 8 MCP tools that give Claude Code deep context about your codebase. Nightly pipeline reviews merges against conventions and generates test suggestions. Supports OpenRouter (cloud) or Ollama (local, zero API calls).

## Philosophy

IMPORTANT: These principles guide every decision in this codebase.

- **Maintainability over performance** — always choose the simpler, more readable solution. Code should be obvious to read, easy to change, and simple to delete. If two approaches work, pick the one a junior developer would understand faster.
- **Simplicity** — fewer moving parts wins. One provider instead of two. Direct function calls instead of wrapper abstractions. If a layer adds no value, delete it. Three lines of direct code is better than one premature abstraction.
- **Single source of truth** — one place for each concern. `infra.ts` for clients, `schema.ts` for DB structure, `env.ts` for config. Never duplicate definitions.
- **Consistency across everything** — naming, versions, patterns, and conventions must be uniform across the entire project. If you change something in one place, find and update every other place.
- **Documentation reflects reality** — if code changes, docs change in the same commit. No stale documentation. Ever. README, CHANGELOG, CONTRIBUTING, standards/ docs, code comments — all must match the current state.
- **Thoroughness** — no loose ends, no half-done work. Fix the edge cases, handle the error paths, check what happens on restart, think about first boot vs existing setup.
- **Production-ready** — bulletproof edge cases, self-healing on failure, proper error messages. Think: "what happens if this fails at 3 AM with no one watching?"
- **Developer experience** — everything should "just work" for someone cloning the repo fresh. Auto-indexing, sensible defaults, clear error messages, default credentials documented.
- **Senior quality** — write code like a senior engineer shipping to production, not like a tutorial. No TODO comments left behind, no dead code, no commented-out blocks.

## Commands

```bash
# Development (from root)
pnpm install                          # install all deps
docker compose up db redis qdrant -d  # infrastructure only
pnpm dev                              # backend + frontend dev servers

# Backend (from backend/)
pnpm test                  # 136 tests, no external deps needed
pnpm check                 # biome lint + tsc type check
pnpm build                 # tsc compile to dist/
pnpm db:migrate            # run Drizzle migrations
pnpm db:generate           # generate migration from schema changes
pnpm index:standards       # CLI: index standards/ into Qdrant
pnpm index:codebase        # CLI: index CODEBASE_REPOS into Qdrant
pnpm index:architecture    # CLI: index architecture + schemas

# Frontend (from frontend/)
pnpm test                  # 30 tests
pnpm check                 # biome lint + vue-tsc type check
pnpm build                 # production build

# Docker (full stack — 6 services)
docker compose up -d --build   # build and start everything
docker compose down -v         # wipe all data (clean slate)
docker compose ps              # check service health
```

## Architecture

- **Backend**: Hono HTTP server + Mastra AI framework + BullMQ jobs
- **Frontend**: Vue 3 + Vite + Tailwind CSS v4 + Pinia stores
- **LLM**: Provider-agnostic — OpenRouter (`minimax/minimax-m2.5`) or Ollama (`qwen3:8b`) via `MODEL_PROVIDER` env var
- **Embeddings**: OpenRouter (`qwen/qwen3-embedding-8b`, 4096 dims) or Ollama (`nomic-embed-text`, 768 dims) — auto-detected
- **Ranking**: Qdrant RRF fusion (dense + BM25 reciprocal rank fusion) — no LLM reranking overhead
- **Vector DB**: Qdrant (6 collections: standards, code-chunks, architecture, schemas, reviews, test-suggestions)
- **Hybrid Search**: Dense vectors (cosine) + BM25 sparse vectors with RRF fusion on code-chunks
- **MCP Annotations**: All 8 tools declare `readOnlyHint: true` + `openWorldHint: false` for Claude Code optimization
- **Compact Mode**: All tools default to `compact: true` — 300-1,500 tokens per call (3 results, summaries). Full mode via `compact: false`.
- **Payload Truncation**: Tool outputs cap large text fields (code: 1500, classContext: 800, standards/architecture: 2000 chars) to reduce Claude Code token processing
- **Database**: PostgreSQL 17 + Drizzle ORM (schema in `backend/src/db/schema.ts`)
- **Auth**: httpOnly cookie JWT (HS256) + refresh token rotation (Redis-backed revocation) + bcrypt
- **Indexing**: Per-file pipeline with `p-limit(3)` concurrency — chunk, contextualize, embed, upsert per file. Data appears in Qdrant immediately. ~20-50 min for 558 files.
- **Streaming**: SSE via `POST /api/chat/stream` (no WebSocket)
- **MCP**: stdio transport (`backend/src/mcp.ts`) + HTTP/SSE transport (`backend/src/routes/mcp.ts`, Bearer auth via `TEAM_API_KEY`)

## Key Patterns

### Single source of truth for infrastructure
All shared singletons live in `backend/src/mastra/infra.ts`: `qdrant` (Mastra wrapper), `rawQdrant` (raw Qdrant client for sparse vectors & Query API), `chatModel`, `embeddingModel`, `ensureCollection()`. Every tool, indexer, and workflow imports from here — never create duplicate clients.

### Provider-agnostic model layer
`infra.ts` exports `chatModel` and `embeddingModel` that work with both OpenRouter and Ollama. Set `MODEL_PROVIDER=ollama` or `MODEL_PROVIDER=openrouter` in env. Ollama uses `@ai-sdk/openai-compatible` (connects to Ollama's OpenAI-compatible `/v1` endpoint). Both return standard AI SDK types (`LanguageModelV3`, `EmbeddingModelV3`).

### Two Qdrant clients
- `qdrant` — Mastra `QdrantVector` wrapper for simple operations (single-vector collections)
- `rawQdrant` — `@qdrant/js-client-rest` `QdrantClient` for sparse vectors, hybrid queries (prefetch + RRF), and point retrieval

### Embedding layer separation
`backend/src/indexer/embed.ts` is pure embedding utilities (`embedText`, `embedTexts`, `toUUID`). It does NOT hold qdrant or collection logic. Those belong in `infra.ts`.

### RAG pipeline (v2.0.0)
1. **AST chunking** — tree-sitter parses Java/TypeScript, regex splits Vue SFC sections then AST-parses `<script>`, SQL stays regex-based
2. **Contextual retrieval** — LLM generates 2-3 sentence context per chunk before embedding (Anthropic technique, 49% fewer retrieval failures)
3. **Header chunk linkage** — each chunk stores `headerChunkId` pointing to its file's imports/class declaration chunk
4. **Dual vectors** — dense (cosine, dimension auto-detected from provider) + sparse BM25 (IDF modifier, server-side) stored per chunk
5. **Hybrid search** — dense + sparse prefetch with RRF fusion via Qdrant Query API (Qdrant handles ranking, no query-time LLM calls)
6. **Header expansion** — batch-fetches header chunks for method-level results to provide class context
7. **Payload truncation** — large text fields capped before returning to Claude Code to minimize token overhead

### Tools import pattern
Every RAG tool in `backend/src/mastra/tools/` follows:
```typescript
import { embedText } from "../../indexer/embed.js";
import { rawQdrant } from "../infra.js";
```

### BullMQ job execution
Simple indexing jobs (standards, codebase, architecture) call indexer functions directly in `backend/src/jobs/queue.ts`. Only `nightly-review` uses a Mastra workflow (multi-step: reindex → review → test suggestions).

### Drizzle migrations
Schema lives in `backend/src/db/schema.ts`. Generate migrations with `pnpm db:generate`. Migration files go in `backend/drizzle/`. Never write raw DDL.

### Frontend stores
- `auth` — httpOnly cookie session (no token in localStorage)
- `chat` — conversations, messages, SSE streaming
- `rate-limit` — 429 countdown tracking

## File Layout

```
backend/src/
  config/env.ts          # Zod-validated env vars (envSchema exported for tests)
  config/logger.ts       # Pino logger
  config/redis.ts        # ioredis client
  db/schema.ts           # Drizzle schema (users, conversations, messages)
  db/connection.ts       # postgres driver + drizzle instance
  db/migrate.ts          # Drizzle migrator
  indexer/ast-chunker.ts # tree-sitter AST parsing (Java, TypeScript, Vue <script>)
  indexer/bm25.ts        # BM25 tokenizer for sparse vectors (FNV-1a hashing)
  indexer/chunker.ts     # language dispatcher → AST or regex chunking
  indexer/contextualize.ts # contextual retrieval — LLM context per chunk before embedding
  indexer/embed.ts       # embedText, embedTexts, toUUID (uses embeddingModel from infra.ts)
  indexer/redact.ts      # redactSecrets — strips secrets before sending to APIs
  indexer/fs.ts          # shared findMarkdownFiles utility
  indexer/git-diff.ts    # git operations (getChangedFiles, getDeletedFiles, getMergeCommits — execFile, never exec)
  indexer/index-*.ts     # indexing pipelines per collection
  mastra/infra.ts        # qdrant + rawQdrant + chatModel + embeddingModel + ensureCollection
  mastra/agents/         # chat-agent.ts, code-review-agent.ts
  mastra/tools/          # 8 RAG tools + truncate.ts helper (search-standards, search-code, get-nightly-summary, etc.)
  mastra/workflows/      # nightly-review.ts (only workflow)
  mastra/memory.ts       # semantic recall + working memory config
  mastra/index.ts        # Mastra instance (agents + workflow + observability)
  jobs/queue.ts          # BullMQ queue, worker, nightly cron schedule
  middleware/rate-limiter.ts  # global, auth, chat rate limiters
  routes/auth.ts         # POST /api/auth/login, /register, /refresh, /logout (httpOnly cookies)
  routes/chat.ts         # POST /api/chat/stream (SSE), GET conversations/messages
  routes/admin.ts        # POST /api/admin/reindex (triggers BullMQ jobs)
  routes/mcp.ts          # MCP HTTP/SSE transport (Bearer auth via TEAM_API_KEY)
  server.ts              # Hono app, middleware stack, startup, shutdown
  mcp.ts                 # MCP stdio server (8 tools exposed)
```

## Gotchas

- **env.ts side effect**: Importing `env.ts` triggers `envSchema.parse(process.env)` at module load. In tests, set required env vars in `beforeAll` before dynamic imports.
- **`.js` extensions in imports**: TypeScript compiles to ESM. All relative imports MUST use `.js` extension (e.g., `import { qdrant } from "../mastra/infra.js"`).
- **JWT_SECRET min 32 chars**: Zod enforces `.min(32)`. Generate with `openssl rand -base64 32`.
- **CODEBASE_REPOS format**: `name:path:branch` comma-separated. Single repo: `myproject:/codebase:develop`. Multi-repo: `api:/codebase/api:develop,ui:/codebase/ui:develop`.
- **Multi-repo indexing**: All repos index into the same `code-chunks` collection with a `repo` metadata field. Chunk IDs include repo name to prevent cross-repo collisions. Per-repo HEAD SHA tracked in Redis as `tiburcio:codebase-head:{repoName}`.
- **Qdrant healthcheck**: Uses `bash -c ':> /dev/tcp/localhost/6333'` because the qdrant image has no curl/wget.
- **Auto-indexing on startup**: Backend checks each Qdrant collection individually and queues missing ones. If you add `CODEBASE_REPOS` later, restart the backend and `code-chunks` will auto-index.
- **`.tibignore`**: Place a `.tibignore` file in each repo root to exclude files from indexing. Uses simple glob patterns (one per line, `*` and `?` supported, `#` for comments). Config files, `.env`, Dockerfiles, and infrastructure dirs are blocked by default.
- **Secret redaction**: `redactSecrets()` in `indexer/redact.ts` strips API keys, connection strings, bearer tokens, AWS keys, and private keys before sending text to OpenRouter or storing in Qdrant. Applied automatically in `embed.ts`, `index-codebase.ts`, and `nightly-review.ts`.
- **Embedding model migration**: Switching `MODEL_PROVIDER` or `EMBEDDING_MODEL` auto-drops all Qdrant collections on next startup (dimensions change). Model identifier stored in Redis as `tiburcio:embedding-model` (format: `ollama:nomic-embed-text` or `openrouter:qwen/qwen3-embedding-8b`). Re-indexing is triggered automatically.
- **OPENROUTER_API_KEY conditional**: Only required when `MODEL_PROVIDER=openrouter`. Zod `.refine()` validates this at startup. When using Ollama, no external API keys are needed.
- **EMBEDDING_DIMENSIONS auto-detection**: Defaults to 768 (Ollama) or 4096 (OpenRouter) based on `MODEL_PROVIDER`. Can be overridden manually. All `ensureCollection()` calls use this value.
- **Full index stores HEAD SHA**: After `indexCodebase` completes, it saves the git HEAD SHA to Redis so the nightly incremental reindex diffs from the right baseline.
- **Stale vector cleanup**: The nightly pipeline deletes all vectors for deleted files (via `getDeletedFiles` with `--diff-filter=D`) and purges all line-level vectors for modified files before re-upserting, preventing orphan vectors from removed functions.
- **BullMQ lock duration**: Worker uses `lockDuration: 300_000` (5 min) and `lockRenewTime: 60_000` (1 min). Default 30s lock causes stalled-job detection during long indexing runs.
- **concurrency: 1** on BullMQ worker: indexing jobs run sequentially to avoid overwhelming OpenRouter rate limits.
- **Contextualization skip logic**: Header chunks (imports/class declarations) and single-chunk small files (< 3000 chars) skip LLM contextualization — they are self-documenting, saving ~40% of LLM calls.
- **Contextualization timeout**: `contextualizeChunk()` uses `AbortSignal.timeout(30_000)`. Timed-out chunks fall back to empty context. The dense + sparse vectors still work.
- **p-limit concurrency**: `index-codebase.ts` uses `p-limit(3)` for file-level parallelism. ~3 concurrent LLM calls at any time, safe for OpenRouter rate limits.
- **pino-pretty**: Only available in dev. Production uses JSON logging. If `NODE_ENV` is not set to `production` in Docker, pino-pretty import crashes the container.
- **tree-sitter native bindings**: Requires `python3`, `make`, `g++` in the Docker build stage. Uses `createRequire()` for CJS interop in ESM project.
- **code-chunks collection is sparse-enabled**: Uses named vectors (`dense` + `bm25`). The `rawQdrant` client must be used for upsert/query on this collection, not the Mastra wrapper.
- **Full reindex required after v1.1 upgrade**: The code-chunks collection schema changed (named vectors + new metadata fields). The indexer automatically drops and recreates it.
- **Docker ports bound to localhost**: Infrastructure services (db, redis, qdrant, langfuse) expose ports only to `127.0.0.1`, not to the network. Backend and frontend are the only publicly accessible services.
- **Security headers**: `secureHeaders()` from `hono/secure-headers` sets X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and HSTS (over HTTPS) on all responses.
- **MCP HTTP/SSE transport**: Mounted at `/mcp` outside the `/api/*` middleware chain (no cookie auth, no global rate limiter). Uses its own Bearer token auth via `TEAM_API_KEY`. Returns 503 if `TEAM_API_KEY` is not set. Uses Mastra's `startHonoSSE()` for native Hono integration.
- **Two MCP entry points**: `src/mcp.ts` for stdio (local dev, `claude mcp add ... -- npx tsx src/mcp.ts`) and `src/routes/mcp.ts` for HTTP/SSE (team deployment). Both expose the same 8 tools.

## Testing

Tests use Vitest with mocks — no external services needed. Key mock patterns:
- `vi.mock("../mastra/infra.js")` for qdrant, rawQdrant, chatModel, embeddingModel
- `vi.mock("../indexer/embed.js")` for embedText
- `vi.mock("../indexer/bm25.js")` for textToSparse (stub in tool tests)
- `vi.mock("../indexer/contextualize.js")` for contextualizeChunks (stub in index-codebase tests)
- `vi.mock("ai")` for generateText (contextualize tests)
- `vi.mock("p-limit")` passthrough mock (index-codebase tests — no real concurrency in tests)
- `vi.mock("../mastra/index.js")` for the Mastra agent
- Chat tests parse SSE events with a `parseSSE()` helper
- Auth tests mock Redis for refresh token jti storage
- Auth tests use real bcrypt (slower but accurate)

Always run `pnpm check && pnpm test` in both backend/ and frontend/ before committing.

## Version

v2.0.0 — consistent across `backend/package.json`, `frontend/package.json`, `backend/src/server.ts`, `backend/src/mcp.ts`.
