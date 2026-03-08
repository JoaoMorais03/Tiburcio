---
title: "feat: OpenRouter local setup readiness — fix blockers + model selection + .env.example"
type: feat
status: active
date: 2026-03-08
---

# OpenRouter Local Setup Readiness

Fix all blockers preventing Tiburcio from running locally with OpenRouter, select the right models, make Langfuse optional (keep for observability), and create `.env.example`.

## Context

Goal: Run Tiburcio MCP-only on local Mac first, then deploy to AWS Lightsail ($10/mo) for 2 users. Using OpenRouter for all embedding + LLM — no local models needed (but keep ability to switch to Ollama later).

---

## Model Selection

### Embedding: `qwen/qwen3-embedding-8b`

| Property | Value |
|---|---|
| Dimensions | **4096** (configurable down to 1024 via Matryoshka) |
| MTEB Code score | **80.68** |
| MTEB English v2 | **75.22** |
| OpenRouter price | **$0.01 / 1M tokens** |
| Ollama | `qwen3-embedding:8b` |
| Context | 32K tokens |

Best all-around choice: beats OpenAI text-embedding-3-small by 13+ points on English, handles code AND natural language docs, runs locally on Ollama too, and costs 2x less than text-embedding-3-small.

**Use 4096 dimensions** (default, maximum quality). Storage is not a concern for team use.

### LLM (contextualization + nightly review): `qwen/qwen3-8b`

| Property | Value |
|---|---|
| Input price | **$0.05 / 1M tokens** |
| Output price | **$0.40 / 1M tokens** |
| Open source | Apache 2.0 |
| Zero retention | Yes (open source model on OpenRouter) |
| Ollama | `qwen3:8b` — same model, runs free locally |
| Code quality | Excellent (heavy code training data) |

Same Qwen3 family as the embedding model — trained on the same code corpus. Open source = zero data retention guaranteed on OpenRouter. Cheapest option with genuine code understanding, and runs on Ollama for fully local later.

**Full index cost (558 files, ~1,674 chunks):**
- Embedding: ~$0.005
- Contextualization: ~$0.07
- **Total: ~$0.08 per full index run**

**Monthly cost (2 users, nightly reindex):**
- Nightly reindex (~50 changed files/day): ~$0.007/night = $0.21/month
- Query embeddings (100 queries/day): ~$0.001/day = negligible
- **Total OpenRouter: ~$1/month**

---

## Changes Required

### 1. Make Langfuse optional in docker-compose

**File:** `docker-compose.yml`

Move `langfuse` to a Docker Compose profile so it starts only with `--profile observability`.

Remove the `langfuse` dependency from `backend`:

```yaml
# BEFORE (line 100-108):
  backend:
    depends_on:
      db:
        condition: service_healthy
      qdrant:
        condition: service_healthy
      redis:
        condition: service_healthy
      langfuse:
        condition: service_started

# AFTER:
  backend:
    depends_on:
      db:
        condition: service_healthy
      qdrant:
        condition: service_healthy
      redis:
        condition: service_healthy
```

Add profile to `langfuse` service:

```yaml
  langfuse:
    image: langfuse/langfuse:2
    profiles: ["observability"]    # ← ADD THIS
    # ... rest stays the same
```

Now:
- `docker compose up db redis qdrant backend -d` — works without Langfuse
- `docker compose --profile observability up -d` — starts everything including Langfuse
- Langfuse env vars (`LANGFUSE_PUBLIC_KEY`, etc.) are already optional in `env.ts` — no code changes needed

### 2. Fix `EMBEDDING_DIMENSIONS` default

**File:** `backend/src/config/env.ts` (line 96)

```typescript
// BEFORE:
parsed.EMBEDDING_DIMENSIONS = parsed.MODEL_PROVIDER === "ollama" ? 768 : 4096;

// AFTER:
parsed.EMBEDDING_DIMENSIONS = parsed.MODEL_PROVIDER === "ollama" ? 768 : 4096;
```

**Actually: 4096 is now CORRECT** for `qwen3-embedding-8b`. No change needed! The current default matches the selected model. If someone uses `text-embedding-3-small` (1536 dims), they override with `EMBEDDING_DIMENSIONS=1536`.

Update the comment in `env.ts` to document this:

```typescript
// Embedding vector dimensions: 768 for nomic-embed-text (Ollama default),
// 4096 for qwen3-embedding-8b (openai-compatible default).
// Must match the chosen embedding model. Override with EMBEDDING_DIMENSIONS env var.
```

### 3. Create `.env.example`

**File:** `.env.example` (repo root)

```env
# === Required ===

# PostgreSQL
POSTGRES_USER=tiburcio
POSTGRES_PASSWORD=tiburcio
POSTGRES_DB=tiburcio
DATABASE_URL=postgres://tiburcio:tiburcio@localhost:5555/tiburcio

# Redis
REDIS_URL=redis://localhost:6379

# Qdrant
QDRANT_URL=http://localhost:6333

# Auth (generate: openssl rand -base64 32)
JWT_SECRET=CHANGE_ME_minimum_32_characters_long

# === Model Provider ===
# "ollama" for local inference (default), "openai-compatible" for OpenRouter/vLLM

MODEL_PROVIDER=openai-compatible

# --- OpenRouter (when MODEL_PROVIDER=openai-compatible) ---
INFERENCE_BASE_URL=https://openrouter.ai/api/v1
INFERENCE_API_KEY=sk-or-CHANGE_ME
INFERENCE_MODEL=qwen/qwen3-8b
INFERENCE_EMBEDDING_MODEL=qwen/qwen3-embedding-8b
# EMBEDDING_DIMENSIONS=4096  # auto-detected, override only if using a different model

# --- Ollama (when MODEL_PROVIDER=ollama — no API key needed) ---
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_CHAT_MODEL=qwen3:8b
# OLLAMA_EMBEDDING_MODEL=qwen3-embedding:8b

# === MCP Team Deployment (optional) ===
# Share this key with colleagues for HTTP/SSE transport access
# TEAM_API_KEY=your-shared-secret-here

# === Codebase Indexing ===
# Format: name:path:branch (comma-separated for multiple repos)
# Docker: paths are relative to container mount at /codebase
# Local dev: use absolute paths
CODEBASE_REPOS=myproject:/codebase:main
# For Docker, set the host path to mount:
CODEBASE_HOST_PATH=/path/to/your/codebase

# === Optional ===

# CORS (default: http://localhost:5173,http://localhost:5174)
# CORS_ORIGINS=http://localhost:5173

# Disable self-registration after creating initial accounts
# DISABLE_REGISTRATION=true

# Neo4j graph layer (for impact analysis — start with: docker compose --profile graph up -d)
# NEO4J_URI=bolt://localhost:7687
# NEO4J_PASSWORD=tiburcio

# Langfuse observability (start with: docker compose --profile observability up -d)
# LANGFUSE_PUBLIC_KEY=pk-lf-local
# LANGFUSE_SECRET_KEY=sk-lf-local
# LANGFUSE_BASE_URL=http://localhost:3001

# PORT=3000
# NODE_ENV=development
```

### 4. Update CLAUDE.md — document new model defaults

Update the "Gotchas" section:

- Change: `Ollama (qwen3:8b, default)` → note that Qwen3-8B is the recommended OpenRouter LLM
- Change: `nomic-embed-text, 768 dims` → note `qwen3-embedding-8b, 4096 dims` as the recommended OpenRouter embedding
- Add: `INFERENCE_EMBEDDING_MODEL` env var documentation (currently missing from Gotchas)
- Update: `EMBEDDING_DIMENSIONS` default explanation

### 5. Update README — add OpenRouter quick start path

Add a second quick-start option after the existing Docker section:

```markdown
### Option B: OpenRouter (no local models)

1. Get an API key from [OpenRouter](https://openrouter.ai)
2. Copy `.env.example` to `.env` and fill in your `INFERENCE_API_KEY`
3. Set `CODEBASE_REPOS` and `CODEBASE_HOST_PATH` to your project
4. `docker compose up db redis qdrant backend -d`
5. Connect Claude Code:
   ```bash
   claude mcp add tiburcio -- npx tsx backend/src/mcp.ts
   ```
```

### 6. Verify backend starts without Langfuse env vars

Check that `backend/src/server.ts` doesn't crash when `LANGFUSE_PUBLIC_KEY` etc. are missing. The env vars are already `z.string().optional()` in `env.ts`, so this should work. But verify there's no Langfuse SDK import that fails on startup without keys.

**File to check:** `backend/src/config/` and any Langfuse integration files.

---

## Acceptance Criteria

- [ ] `docker compose up db redis qdrant backend -d` works without Langfuse
- [ ] `docker compose --profile observability up -d` starts Langfuse
- [ ] `.env.example` exists with OpenRouter defaults (Qwen3-8B + qwen3-embedding-8b)
- [ ] Backend starts cleanly with `MODEL_PROVIDER=openai-compatible`
- [ ] `EMBEDDING_DIMENSIONS` comment updated in `env.ts`
- [ ] README has OpenRouter quick start path
- [ ] CLAUDE.md updated with new model documentation
- [ ] All 167 tests still pass (`pnpm check && pnpm test` in backend/)
- [ ] Embedding dimension auto-detection works correctly (4096 for openai-compatible)

---

## Files to Modify

| File | Change |
|---|---|
| `docker-compose.yml` | Remove langfuse from backend depends_on, add `profiles: ["observability"]` to langfuse |
| `.env.example` | Create — full template with OpenRouter defaults |
| `backend/src/config/env.ts` | Update EMBEDDING_DIMENSIONS comment only |
| `README.md` | Add OpenRouter quick start section |
| `CLAUDE.md` | Update model defaults + add INFERENCE_EMBEDDING_MODEL docs |

---

## `.env` for your first local run

```env
POSTGRES_USER=tiburcio
POSTGRES_PASSWORD=tiburcio
POSTGRES_DB=tiburcio
DATABASE_URL=postgres://tiburcio:tiburcio@localhost:5555/tiburcio
REDIS_URL=redis://localhost:6379
QDRANT_URL=http://localhost:6333
JWT_SECRET=<run: openssl rand -base64 32>

MODEL_PROVIDER=openai-compatible
INFERENCE_BASE_URL=https://openrouter.ai/api/v1
INFERENCE_API_KEY=sk-or-<your key>
INFERENCE_MODEL=qwen/qwen3-8b
INFERENCE_EMBEDDING_MODEL=qwen/qwen3-embedding-8b

CODEBASE_REPOS=<your-project-name>:/codebase:main
CODEBASE_HOST_PATH=/path/to/your/project
```

Then:
```bash
docker compose up db redis qdrant -d       # infrastructure
cd backend && pnpm dev                     # backend in dev mode
# OR for MCP stdio:
npx tsx backend/src/mcp.ts
```

---

## Sources

- [Qwen3-Embedding-8B on OpenRouter](https://openrouter.ai/qwen/qwen3-embedding-8b) — $0.01/1M tokens, 4096 dims
- [Gemini 2.0 Flash on OpenRouter](https://openrouter.ai/google/gemini-2.0-flash-001) — $0.10/$0.40 per 1M tokens
- [Qwen3-Embedding-8B MTEB](https://huggingface.co/Qwen/Qwen3-Embedding-8B) — 80.68 MTEB-Code, 75.22 MTEB-English
- `backend/src/config/env.ts` — env var definitions, EMBEDDING_DIMENSIONS default
- `backend/src/lib/model-provider.ts` — getChatModel(), getEmbeddingModel()
- `docker-compose.yml` — langfuse dependency on line 107-108
