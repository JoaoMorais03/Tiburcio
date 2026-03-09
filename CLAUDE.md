# Tiburcio — Claude Code Configuration

Developer intelligence MCP. Indexes team docs, source code, and conventions into Qdrant, then exposes 10 MCP tools that give Claude Code deep context about your codebase. Nightly pipeline reviews merges against conventions and generates test suggestions. Supports Ollama (local, zero API calls) or any OpenAI-compatible endpoint (vLLM, OpenRouter, etc.).

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
pnpm test                  # 137 tests, no external deps needed
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

- **Backend**: Hono HTTP server + Vercel AI SDK v6 + MCP TypeScript SDK + BullMQ jobs
- **Frontend**: Vue 3 + Vite + Tailwind CSS v4 + Pinia stores
- **LLM**: Provider-agnostic via `lib/model-provider.ts` — Ollama (`qwen3:8b`, default) or any OpenAI-compatible endpoint (vLLM, OpenRouter) via `MODEL_PROVIDER` env var. Recommended OpenRouter model: `qwen/qwen3-8b` (open source, zero retention)
- **Embeddings**: Ollama (`nomic-embed-text`, 768 dims) or OpenAI-compatible via `INFERENCE_EMBEDDING_MODEL` env var — auto-defaults based on provider. Recommended OpenRouter model: `qwen/qwen3-embedding-8b` (4096 dims, MTEB-Code 80.68)
- **Ranking**: Qdrant RRF fusion (dense + BM25 reciprocal rank fusion) — no LLM reranking overhead
- **Vector DB**: Qdrant (6 collections: standards, code-chunks, architecture, schemas, reviews, test-suggestions)
- **Hybrid Search**: Dense vectors (cosine) + BM25 sparse vectors with RRF fusion on code-chunks
- **MCP Annotations**: All 10 tools declare `readOnlyHint: true` + `openWorldHint: false` for Claude Code optimization
- **Compact Mode**: All tools default to `compact: true` — 300-1,500 tokens per call (3 results, code previews). Full mode via `compact: false`.
- **Git Fallbacks**: Nightly-dependent tools (`getNightlySummary`, `getChangeSummary`, `searchReviews`, `getTestSuggestions`) fall back to raw `git log` data when Qdrant collections are empty. Responses include `source: "git-log"` field.
- **Payload Truncation**: Tool outputs cap large text fields (code: 1500, classContext: 800, standards/architecture: 2000 chars) to reduce Claude Code token processing
- **Database**: PostgreSQL 17 + Drizzle ORM (schema in `backend/src/db/schema.ts`)
- **Auth**: httpOnly cookie JWT (HS256) + refresh token rotation (Redis-backed revocation) + bcrypt
- **Indexing**: Per-file pipeline with `p-limit(3)` concurrency — chunk, contextualize, embed, upsert per file. Data appears in Qdrant immediately. ~20-50 min for 558 files.
- **Observability**: Langfuse (`lib/langfuse.ts`) — lazy singleton, traces MCP tool calls, LLM generations (embeddings, contextualization, nightly review, chat), and background jobs. Activated by setting `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`. `LANGFUSE_RECORD_IO=false` disables input/output recording for privacy.
- **Streaming**: SSE via `POST /api/chat/stream` (no WebSocket)
- **MCP**: stdio transport (`backend/src/mcp.ts`) + HTTP/SSE transport (`backend/src/routes/mcp.ts`, Bearer auth via `TEAM_API_KEY`)

## Key Patterns

### Single source of truth for infrastructure
All shared singletons live in `backend/src/mastra/infra.ts`: `rawQdrant` (Qdrant client for all vector ops), `ensureCollection()`. Every tool, indexer, and workflow imports from here — never create duplicate clients.

### Provider-agnostic model layer
`backend/src/lib/model-provider.ts` exports `getChatModel()` and `getEmbeddingModel()`. Set `MODEL_PROVIDER=ollama` (default) or `MODEL_PROVIDER=openai-compatible` in env. Ollama uses `ollama-ai-provider`. OpenAI-compatible uses `@ai-sdk/openai` createOpenAI (works with vLLM, OpenRouter, LM Studio, etc.). Both return standard AI SDK types (`LanguageModelV3`, `EmbeddingModelV3`).

### One Qdrant client
- `rawQdrant` — `@qdrant/js-client-rest` `QdrantClient` for all operations: simple search, sparse vectors, hybrid queries (prefetch + RRF), and point retrieval. All 6 collections use `rawQdrant` directly.

### Embedding layer separation
`backend/src/indexer/embed.ts` is pure embedding utilities (`embedText`, `embedTexts`, `toUUID`). It does NOT hold qdrant or collection logic. Those belong in `infra.ts`.

### RAG pipeline (v2.2.0)
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
All jobs call indexer functions directly in `backend/src/jobs/queue.ts`. The nightly review job runs `nightly-review.ts` which orchestrates: reindex → code review (AI SDK `generateText` with tools) → test suggestions.

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
  lib/langfuse.ts        # Langfuse singleton (getLangfuse, shutdownLangfuse, traceToolCall)
  lib/model-provider.ts  # getChatModel() + getEmbeddingModel() — Ollama or OpenAI-compatible
  db/schema.ts           # Drizzle schema (users, conversations, messages)
  db/connection.ts       # postgres driver + drizzle instance
  db/migrate.ts          # Drizzle migrator
  indexer/ast-chunker.ts # tree-sitter AST parsing (Java, TypeScript, Vue <script>)
  indexer/bm25.ts        # BM25 tokenizer for sparse vectors (FNV-1a hashing)
  indexer/chunker.ts     # language dispatcher → AST or regex chunking
  indexer/contextualize.ts # contextual retrieval — LLM context per chunk before embedding
  indexer/embed.ts       # embedText, embedTexts, toUUID (uses getEmbeddingModel())
  indexer/redact.ts      # redactSecrets — strips secrets before sending to APIs
  indexer/text-splitter.ts # splitText() — replaces @mastra/rag MDocument chunking
  indexer/fs.ts          # shared findMarkdownFiles utility
  indexer/git-diff.ts    # git operations (getChangedFiles, getDeletedFiles, getMergeCommits — execFile, never exec)
  indexer/index-*.ts     # indexing pipelines per collection
  mastra/infra.ts        # rawQdrant + ensureCollection (no chatModel/embeddingModel — use lib/model-provider.ts)
  mastra/tools/          # 10 RAG tools + truncate.ts + git-fallback.ts (search-standards, search-code, get-nightly-summary, get-change-summary, get-impact-analysis, etc.)
  mastra/workflows/      # nightly-review.ts (multi-step orchestration via AI SDK generateText)
  jobs/queue.ts          # BullMQ queue, worker, nightly cron schedule
  middleware/rate-limiter.ts  # global, auth, chat rate limiters
  routes/auth.ts         # POST /api/auth/login, /register, /refresh, /logout (httpOnly cookies)
  routes/chat.ts         # POST /api/chat/stream (SSE via AI SDK streamText), GET conversations/messages
  routes/admin.ts        # POST /api/admin/reindex (triggers BullMQ jobs)
  routes/mcp.ts          # MCP HTTP/SSE transport (Bearer auth via TEAM_API_KEY)
  server.ts              # Hono app, middleware stack, startup, shutdown
  mcp.ts                 # MCP stdio server (10 tools via @modelcontextprotocol/sdk)
```

## Gotchas

- **env.ts side effect**: Importing `env.ts` triggers `envSchema.parse(process.env)` at module load. In tests, set required env vars in `beforeAll` before dynamic imports.
- **`.js` extensions in imports**: TypeScript compiles to ESM. All relative imports MUST use `.js` extension (e.g., `import { qdrant } from "../mastra/infra.js"`).
- **JWT_SECRET min 32 chars**: Zod enforces `.min(32)`. Generate with `openssl rand -base64 32`.
- **CODEBASE_REPOS format**: `name:path:branch` comma-separated. Single repo: `myproject:/codebase:develop`. Multi-repo: `api:/codebase/api:develop,ui:/codebase/ui:develop`.
- **Multi-repo indexing**: All repos index into the same `code-chunks` collection with a `repo` metadata field. Chunk IDs include repo name to prevent cross-repo collisions. Per-repo HEAD SHA tracked in Redis as `tiburcio:codebase-head:{repoName}`.
- **Qdrant healthcheck**: Uses `bash -c ':> /dev/tcp/localhost/6333'` because the qdrant image has no curl/wget.
- **Auto-indexing on startup**: Backend checks each Qdrant collection individually and queues missing ones. If you add `CODEBASE_REPOS` later, restart the backend and `code-chunks` will auto-index.
- **Neo4j auto-build**: After `index-codebase` completes, `buildGraph()` is called automatically when `NEO4J_URI` is configured. No need to wait for the nightly pipeline.
- **Git fallbacks**: When Qdrant `reviews`/`test-suggestions` collections are empty, nightly-dependent tools fall back to `git log` data from `CODEBASE_REPOS`. Requires repo paths to be accessible at runtime. Fallback responses include `source: "git-log"` and a `notice` field.
- **Pipeline health tracking**: Nightly pipeline writes `tiburcio:nightly:last-run`, `tiburcio:nightly:last-status`, and `tiburcio:nightly:last-error` to Redis. Exposed in `/api/health` response under `pipeline`.
- **`.tibignore`**: Place a `.tibignore` file in each repo root to exclude files from indexing. Uses simple glob patterns (one per line, `*` and `?` supported, `#` for comments). Config files, `.env`, Dockerfiles, and infrastructure dirs are blocked by default.
- **Secret redaction**: `redactSecrets()` in `indexer/redact.ts` strips API keys, connection strings, bearer tokens, AWS keys, and private keys before sending to inference APIs or storing in Qdrant. Applied automatically in `embed.ts`, `index-codebase.ts`, and `nightly-review.ts`.
- **Embedding model migration**: Switching `MODEL_PROVIDER` or embedding model auto-drops all Qdrant collections on next startup (dimensions change). Model identifier stored in Redis as `tiburcio:embedding-model` (format: `ollama:nomic-embed-text` or `openai-compatible:qwen/qwen3-embedding-8b`). Re-indexing is triggered automatically.
- **INFERENCE_* vars conditional**: Only required when `MODEL_PROVIDER=openai-compatible`. Zod `.refine()` validates that `INFERENCE_BASE_URL` and `INFERENCE_MODEL` are both set. `INFERENCE_EMBEDDING_MODEL` sets the embedding model (e.g., `qwen/qwen3-embedding-8b`). When using Ollama, no external API keys are needed.
- **EMBEDDING_DIMENSIONS auto-detection**: Defaults to 768 (Ollama/nomic-embed-text) or 4096 (openai-compatible/qwen3-embedding-8b) based on `MODEL_PROVIDER`. Can be overridden manually via `EMBEDDING_DIMENSIONS` env var. All `ensureCollection()` calls use this value.
- **Langfuse is optional**: Backend works without Langfuse env vars — all keys are `z.string().optional()`. When `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set, `getLangfuse()` returns a singleton client that traces MCP tool calls, LLM generations, and background jobs. When not set, all tracing is no-op (null checks). `LANGFUSE_RECORD_IO=false` disables input/output recording for privacy. `shutdownLangfuse()` is called on graceful shutdown in both `server.ts` and `mcp.ts`. Docker Compose profile: `docker compose --profile observability up -d`.
- **Full index stores HEAD SHA**: After `indexCodebase` completes, it saves the git HEAD SHA to Redis so the nightly incremental reindex diffs from the right baseline.
- **Stale vector cleanup**: The nightly pipeline deletes all vectors for deleted files (via `getDeletedFiles` with `--diff-filter=D`) and purges all line-level vectors for modified files before re-upserting, preventing orphan vectors from removed functions.
- **BullMQ lock duration**: Worker uses `lockDuration: 300_000` (5 min) and `lockRenewTime: 60_000` (1 min). Default 30s lock causes stalled-job detection during long indexing runs.
- **concurrency: 1** on BullMQ worker: indexing jobs run sequentially to avoid overwhelming inference API rate limits.
- **Contextualization skip logic**: Header chunks (imports/class declarations) and single-chunk small files (< 3000 chars) skip LLM contextualization — they are self-documenting, saving ~40% of LLM calls.
- **Contextualization timeout**: `contextualizeChunk()` uses `AbortSignal.timeout(30_000)`. Timed-out chunks fall back to empty context. The dense + sparse vectors still work.
- **p-limit concurrency**: `index-codebase.ts` uses `p-limit(3)` for file-level parallelism. ~3 concurrent LLM calls at any time, safe for inference API rate limits.
- **pino-pretty**: Only available in dev. Production uses JSON logging. If `NODE_ENV` is not set to `production` in Docker, pino-pretty import crashes the container.
- **tree-sitter native bindings**: Requires `python3`, `make`, `g++` in the Docker build stage. Uses `createRequire()` for CJS interop in ESM project.
- **code-chunks collection is sparse-enabled**: Uses named vectors (`dense` + `bm25`). Always use `rawQdrant` for upsert/query on this collection.
- **Full reindex required after v1.1 upgrade**: The code-chunks collection schema changed (named vectors + new metadata fields). The indexer automatically drops and recreates it.
- **Docker ports bound to localhost**: Infrastructure services (db, redis, qdrant, langfuse) expose ports only to `127.0.0.1`, not to the network. Backend and frontend are the only publicly accessible services.
- **Security headers**: `secureHeaders()` from `hono/secure-headers` sets X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and HSTS (over HTTPS) on all responses.
- **MCP HTTP/SSE transport**: Mounted at `/mcp` outside the `/api/*` middleware chain (no cookie auth, no global rate limiter). Uses its own Bearer token auth via `TEAM_API_KEY`. Returns 503 if `TEAM_API_KEY` is not set. Uses `SSEServerTransport` from `@modelcontextprotocol/sdk`.
- **Two MCP entry points**: `src/mcp.ts` for stdio (local dev, `claude mcp add tiburcio -- npx tsx src/mcp.ts`) and `src/routes/mcp.ts` for HTTP/SSE (team deployment). Both use `SSEServerTransport` (HTTP/SSE) and `StdioServerTransport` (stdio) respectively, and call the shared `registerTools(server)` from `src/mcp-tools.ts`. Both expose the same 10 tools.
- **AI SDK v6 tools**: Tools use `inputSchema:` (not `parameters:`). Import `z` from `"zod"` (v3), not `"zod/v4"` — AI SDK v6's `FlexibleSchema` requires Zod v3 types. Each tool file exports both `executeFoo()` (standalone async fn) and `fooTool` (AI SDK tool object).
- **`stopWhen: stepCountIs(N)`**: AI SDK v6 replaced `maxSteps: N` with `stopWhen: stepCountIs(N)` imported from `"ai"`.

## Testing

Tests use Vitest with mocks — no external services needed. Key mock patterns:
- `vi.mock("../mastra/infra.js")` for `rawQdrant` (search, query, retrieve, upsert, delete)
- `vi.mock("../indexer/embed.js")` for embedText
- `vi.mock("../indexer/bm25.js")` for textToSparse (stub in tool tests)
- `vi.mock("../indexer/contextualize.js")` for contextualizeChunks (stub in index-codebase tests)
- `vi.mock("../lib/model-provider.js")` for getChatModel (returns `{}`)
- `vi.mock("ai", async (importOriginal) => ({ ...actual, streamText: vi.fn() }))` — chat tests
- `vi.mock("ai")` for generateText (contextualize and nightly-review tests)
- `vi.mock("p-limit")` passthrough mock (index-codebase tests — no real concurrency in tests)
- Tool tests use `qdrantHit(score, payload)` helper to match `rawQdrant.search()` return format
- Chat tests parse SSE events with a `parseSSE()` helper
- Auth tests mock Redis for refresh token jti storage
- Auth tests use real bcrypt (slower but accurate)

Always run `pnpm check && pnpm test` in both backend/ and frontend/ before committing.

## Version

v2.2.0 — consistent across `backend/package.json`, `frontend/package.json`, `backend/src/server.ts`, `backend/src/mcp.ts`.
