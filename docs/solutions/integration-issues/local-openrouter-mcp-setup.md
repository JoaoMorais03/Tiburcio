---
title: "Local Tiburcio Setup with OpenRouter + Claude Code MCP"
date: 2026-03-08
category: integration-issues
tags: [openrouter, mcp, docker, claude-code, setup, stdio]
modules: [config/env.ts, lib/model-provider.ts, mcp.ts, docker-compose.yml]
severity: high
status: solved
---

# Local Tiburcio Setup with OpenRouter + Claude Code MCP

## Problem

Setting up Tiburcio MCP locally with OpenRouter as the inference provider involves multiple components (Docker, env vars, MCP transport) with non-obvious gotchas that block first-time setup.

## Prerequisites

- Docker Desktop running
- Node.js 20+ installed
- `pnpm` available (or via `npx pnpm`)
- An OpenRouter API key from https://openrouter.ai
- Dependencies installed: `pnpm install` (from repo root)

## Step-by-Step Setup

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` — only 4 values need changing:

| Variable | What to set |
|----------|-------------|
| `INFERENCE_API_KEY` | Your OpenRouter key (`sk-or-...`) |
| `JWT_SECRET` | Run `openssl rand -base64 32` |
| `CODEBASE_HOST_PATH` | Absolute path to the repo you want to index |
| `CODEBASE_REPOS` | `reponame:/codebase:branch` (e.g. `tiburcio:/codebase:main`) |

Everything else has working defaults:
- `MODEL_PROVIDER=openai-compatible` (OpenRouter)
- `INFERENCE_MODEL=qwen/qwen3-8b` (open source, zero data retention)
- `INFERENCE_EMBEDDING_MODEL=qwen/qwen3-embedding-8b` (4096 dims, MTEB-Code 80.68)
- Database, Redis, Qdrant URLs all default to localhost

### 2. Start infrastructure + backend

```bash
# MCP-only (no frontend needed):
docker compose up db redis qdrant backend -d --build

# Or with docker-compose v1:
docker-compose up db redis qdrant backend -d --build
```

The backend auto-indexes on first boot:
1. Standards (13 docs from `standards/`)
2. Architecture + schemas
3. Codebase (all source files via AST chunking + contextual retrieval)

Watch progress:
```bash
docker compose logs -f backend
```

Wait until you see: `"msg":"Codebase indexing complete"`

### 3. Verify health

```bash
curl http://localhost:3333/api/health
```

Expected: `{"status":"ok","checks":{"database":true,"redis":true,"qdrant":true}}`

### 4. Connect Claude Code via stdio

```bash
claude mcp add tiburcio \
  -e "DATABASE_URL=postgres://tiburcio:tiburcio@localhost:5555/tiburcio" \
  -e "REDIS_URL=redis://localhost:6379" \
  -e "QDRANT_URL=http://localhost:6333" \
  -e "JWT_SECRET=YOUR_JWT_SECRET_HERE" \
  -e "MODEL_PROVIDER=openai-compatible" \
  -e "INFERENCE_BASE_URL=https://openrouter.ai/api/v1" \
  -e "INFERENCE_API_KEY=sk-or-YOUR_KEY_HERE" \
  -e "INFERENCE_MODEL=qwen/qwen3-8b" \
  -e "INFERENCE_EMBEDDING_MODEL=qwen/qwen3-embedding-8b" \
  -- npx tsx backend/src/mcp.ts
```

### 5. Restart Claude Code

Exit the current session and open a new one. Run `/mcp` to verify:

```
Status: connected
Tools: 10 tools
```

## What You Can Explore

| URL / Command | What it shows |
|---------------|---------------|
| http://localhost:6333/dashboard | Qdrant vector DB — browse collections, see indexed chunks |
| http://localhost:3333/api/health | Service health (database, Redis, Qdrant) |
| http://localhost:3333/ | Backend version info |
| http://localhost:7474 | Neo4j browser — explore dependency graph (optional, `--profile graph`) |
| `docker compose logs -f backend` | Live logs — see tool calls, embeddings, errors |
| `docker exec tiburcio-redis-1 redis-cli keys "tiburcio:*"` | Redis state (embedding model, HEAD SHA) |

## 10 MCP Tools Available

| Tool | What it does |
|------|-------------|
| `searchStandards` | Team coding standards, conventions, best practices |
| `getPattern` | Code templates and boilerplate patterns |
| `searchCode` | Hybrid search (semantic + BM25 keyword) on codebase |
| `getArchitecture` | System design and component diagrams |
| `searchSchemas` | Database schema documentation |
| `searchReviews` | Nightly code review notes |
| `getTestSuggestions` | AI-generated test cases |
| `getNightlySummary` | Consolidated morning briefing |
| `getChangeSummary` | What changed since a date/time |
| `getImpactAnalysis` | Dependency tracing (requires Neo4j) |

## Gotchas and Common Mistakes

| Mistake | What happens | Fix |
|---------|-------------|-----|
| Using `--transport sse` with Claude Code | OAuth 404 error — Claude Code 2026 requires OAuth for SSE | Use stdio transport (no `--transport` flag) |
| Forgetting `-e` flags on `claude mcp add` | `ZodError: DATABASE_URL Required` — stdio process can't see `.env` | Pass all required env vars via `-e` |
| Running `docker compose restart` after `.env` change | Container keeps old env values | Use `docker compose up --force-recreate` |
| Not overriding Redis/Qdrant URLs in docker-compose.yml | Backend container can't reach `localhost` services | docker-compose.yml environment section overrides URLs to Docker service names |
| Uncommenting `OLLAMA_EMBEDDING_MODEL=qwen3-embedding:8b` without setting `EMBEDDING_DIMENSIONS=4096` | Dimension mismatch — Ollama auto-defaults to 768 dims | Either keep `nomic-embed-text` (768) or set `EMBEDDING_DIMENSIONS=4096` |
| Not waiting for indexing to complete | Tools return empty results | Watch logs until `"Codebase indexing complete"` |

## Indexing Stats (Tiburcio self-index)

- **Files indexed:** 96
- **Total chunks:** 310 (dense + sparse BM25 vectors)
- **Contextualization skipped:** 70 chunks (header/small-file optimization)
- **Time:** ~12 minutes
- **Cost:** ~$0.08 on OpenRouter
- **Monthly cost (2 users, nightly reindex):** ~$1/month

## Verification Checklist

- [ ] `curl http://localhost:3333/api/health` returns `"status":"ok"`
- [ ] Qdrant dashboard shows collections: `standards`, `code-chunks`, `architecture`, `schemas`
- [ ] `/mcp` in Claude Code shows "Status: connected, Tools: 10 tools"
- [ ] Ask Claude Code: "What are the coding standards?" — should get real answers from your codebase

## Root Cause (SSE transport failure)

Claude Code 2026 implements the MCP spec's OAuth requirement for HTTP/SSE transports. When connecting to an SSE endpoint, Claude Code first tries `/.well-known/oauth-authorization-server` discovery. Tiburcio uses simple Bearer token auth (not OAuth), so this returns 404, causing the "Invalid OAuth error response" error.

**Solution:** Use stdio transport. The stdio MCP process (`npx tsx backend/src/mcp.ts`) runs locally, connects to Docker services via localhost ports, and communicates with Claude Code over stdin/stdout — no OAuth needed.

## Troubleshooting

**Backend container exits immediately:**
Check logs with `docker compose logs backend`. Common causes: missing env vars, database not ready (healthcheck not passed), or `pino-pretty` import failure if `NODE_ENV` is not `production` in Docker.

**"Connection refused" on health check:**
Ensure the backend container is running (`docker compose ps`). The backend maps to port 3333. If another process uses that port, stop it first.

**MCP shows "disconnected" in Claude Code:**
Test the stdio process directly:
```bash
DATABASE_URL=postgres://tiburcio:tiburcio@localhost:5555/tiburcio \
REDIS_URL=redis://localhost:6379 \
QDRANT_URL=http://localhost:6333 \
JWT_SECRET=your_secret_here \
MODEL_PROVIDER=openai-compatible \
INFERENCE_BASE_URL=https://openrouter.ai/api/v1 \
INFERENCE_API_KEY=sk-or-your_key \
INFERENCE_MODEL=qwen/qwen3-8b \
INFERENCE_EMBEDDING_MODEL=qwen/qwen3-embedding-8b \
npx tsx backend/src/mcp.ts
```
It should start without errors and wait for stdio input. If it crashes, the error message tells you which env var is missing.

**Qdrant dashboard shows 0 points:**
Indexing may still be in progress. Check `docker compose logs -f backend` for progress lines like `"progress":"45/96"`. If indexing completed but collections are empty, restart backend to re-trigger: `docker compose up --force-recreate backend -d`.

**Embedding model changed accidentally:**
Switching `MODEL_PROVIDER` or embedding model auto-drops all Qdrant collections (dimensions change). The model ID is tracked in Redis as `tiburcio:embedding-model`. Re-indexing starts automatically on next boot.

## Optional: Neo4j Impact Analysis

Enable the `getImpactAnalysis` tool — trace which files depend on a target before refactoring:

```bash
docker compose --profile graph up -d
```

Add these `-e` flags when connecting Claude Code via stdio:

```bash
-e "NEO4J_URI=bolt://localhost:7687" \
-e "NEO4J_PASSWORD=tiburcio"
```

Browse the graph at http://localhost:7474 (login: `neo4j` / `tiburcio`).

The graph builds automatically after codebase indexing completes (when `NEO4J_URI` is set). To rebuild manually, trigger a reindex via the admin API.

**Memory:** ~200MB RAM. **Build time:** <5s per repo.

## Optional: Langfuse Observability

Track tool call counts, token usage, and cost per model:

```bash
docker compose --profile observability up -d
```

Open http://localhost:3001 (default login: admin@example.com / admin123)

## Cloud Deployment (Lightsail, VPS, etc.)

The same Docker Compose setup works on any VM. Key differences:

1. **Clone the repo on the server** and configure `.env` as above
2. **Start services:** `docker compose up db redis qdrant backend -d --build`
3. **Connect via SSH stdio** — each developer runs:
   ```bash
   claude mcp add tiburcio \
     -- ssh your-server "cd /path/to/tiburcio && \
       DATABASE_URL=postgres://tiburcio:tiburcio@localhost:5555/tiburcio \
       REDIS_URL=redis://localhost:6379 \
       QDRANT_URL=http://localhost:6333 \
       JWT_SECRET=YOUR_SECRET \
       MODEL_PROVIDER=openai-compatible \
       INFERENCE_BASE_URL=https://openrouter.ai/api/v1 \
       INFERENCE_API_KEY=sk-or-YOUR_KEY \
       INFERENCE_MODEL=qwen/qwen3-8b \
       INFERENCE_EMBEDDING_MODEL=qwen/qwen3-embedding-8b \
       npx tsx backend/src/mcp.ts"
   ```

**Minimum RAM:** ~2GB without Neo4j, ~3GB with Neo4j. A Lightsail 4GB ($24/mo) handles everything.

**SSE won't work** — Claude Code 2026 requires OAuth for HTTP transports. SSH stdio bypasses this entirely.

## Optional: Team HTTP/SSE Deployment

For sharing with teammates (when OAuth is not required by the client), set `TEAM_API_KEY` in `.env` and use:

```bash
docker compose up --force-recreate backend -d
```

The MCP endpoint is at `http://your-server:3333/mcp/sse` with Bearer token auth.
