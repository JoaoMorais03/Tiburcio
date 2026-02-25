# Proposal: Shared Tiburcio Pod for the Prozis Team

## The Problem

Right now, every developer who wants Tiburcio needs to run **6 Docker containers** on their own machine: PostgreSQL, Redis, Qdrant, Langfuse, Backend, Frontend. That's ~4GB of RAM per dev, duplicated indexing of the same codebase on every machine, and a setup process that involves certificates, environment files, and volume mounts.

8 developers = 8 identical copies of the same infrastructure, indexing the same ProzisHUB repo independently, eating 32GB of RAM across the team.

## The Solution

**One pod. One deployment. Everyone connects to it.**

Deploy Tiburcio once on a single pod/VPS. Every developer's Claude Code connects to it remotely — zero local install. The web UI is also available at the same URL for anyone who wants the chat interface in a browser.

```
┌─── Dev 1: Claude Code ──► MCP (HTTPS)
│
│    Dev 2: Claude Code ──► MCP (HTTPS)
│
│    Dev 3: Browser ───────► Web UI (HTTPS)       Tiburcio Pod
│                                                 ┌──────────────┐
│    Dev 4: Claude Code ──► MCP (HTTPS)  ────►    │ Reverse Proxy │
│                                                 │ Backend + MCP │
│    Dev 5: Claude Code ──► MCP (HTTPS)           │ Qdrant        │
│                                                 │ PostgreSQL    │
│    Dev 6: Browser ───────► Web UI (HTTPS)       │ Redis         │
│                                                 └──────────────┘
│    Dev 7: Claude Code ──► MCP (HTTPS)
│
└─── Dev 8: Claude Code ──► MCP (HTTPS)
```

## What Each Developer Does (Total Setup)

### Option A: Claude Code MCP (semantic search in terminal)

Add one line to Claude Code config:

```bash
claude mcp add tiburcio --transport sse --url https://tiburcio.prozis.internal/mcp --header "Authorization:Bearer <team-api-key>"
```

Done. Claude Code now has 7 tools that search the ProzisHUB codebase:

| Tool | What It Does |
|------|-------------|
| `searchCode` | Hybrid search (semantic + keyword) over all Java/TS/Vue/SQL code with AST-level precision |
| `searchStandards` | Search team conventions, coding standards, best practices |
| `getArchitecture` | Search architecture docs, system flows, component diagrams |
| `searchSchemas` | Search database tables, columns, relationships |
| `getPattern` | Get specific code templates and boilerplates |
| `searchReviews` | Search nightly code review insights from recent merges |
| `getTestSuggestions` | Get AI-generated test suggestions for recently changed code |

### Option B: Web UI (chat interface in browser)

Open `https://tiburcio.prozis.internal` in a browser. Register. Chat.

Same tools, but with a conversational interface, message history, and working memory that remembers your context across sessions.

## What Changes in the Codebase

Minimal. One new feature:

1. **Add HTTP transport to the MCP server** — currently `mcp.ts` uses stdio (local process). Add an SSE/Streamable HTTP endpoint mounted on the Hono backend at `/mcp`. The MCP SDK supports this natively. ~50 lines of code.
2. **API key auth for `/mcp`** — simple `TEAM_API_KEY` env var. MCP clients send it as a Bearer header. Prevents unauthorized access.
3. **Reverse proxy for HTTPS** — add Caddy (or Traefik) to `docker-compose.yml`. Automatic TLS certificates.

Everything else — tools, indexers, Qdrant, nightly pipeline, web UI — stays exactly the same.

## Why This Is Better

| Aspect | 8 Local Installs | 1 Shared Pod |
|--------|-------------------|--------------|
| RAM usage (total) | ~32 GB across team | ~4 GB on pod |
| Codebase indexing | 8 independent indexes | 1 shared index |
| Nightly pipeline | runs 8 times or not at all | runs once, benefits everyone |
| Setup per developer | Docker + .env + certs + volumes | one CLI command |
| Time to first query | ~30 min setup + indexing | ~30 seconds |
| Index freshness | depends on each dev restarting | nightly auto-reindex from main |
| Consistency | each dev may have different index state | everyone searches the same data |
| New team member onboarding | repeat full setup | paste one config line |

## Resource Requirements

### What the Pod Needs

| Component | RAM | CPU | Disk | Notes |
|-----------|-----|-----|------|-------|
| Qdrant | ~2 GB | low | ~2 GB | Vector storage for ~50K code chunks |
| PostgreSQL | ~256 MB | low | ~500 MB | Users, conversations, messages |
| Redis | ~128 MB | low | minimal | Rate limiting, job queue, sessions |
| Backend (Node.js) | ~512 MB | moderate | minimal | Hono server + MCP + indexing |
| Frontend (Nginx) | ~64 MB | minimal | ~20 MB | Static SPA, proxies API calls |
| Langfuse | ~512 MB | low | shared with PG | LLM observability (optional) |
| **Total** | **~3.5 GB** | **2-4 cores** | **~5 GB** | Comfortable with 4 GB RAM pod |

A **4 GB RAM / 2 vCPU pod** handles this easily. 8 GB gives headroom for a larger codebase.

### External Costs

| Service | Usage | Monthly Cost |
|---------|-------|-------------|
| OpenRouter API (embeddings) | Initial index: ~$0.05, nightly diffs: ~$0.01/night | ~$0.35/month |
| OpenRouter API (queries) | ~$0.003 per search query | ~$5-15/month for 8 active devs |
| OpenRouter API (chat via web UI) | ~$0.02 per conversation | ~$5-10/month |
| **Total OpenRouter** | | **~$10-25/month** |

That's ~$1.50-3.00 per developer per month. Less than a coffee.

## What the Team Gets

### Day 1 (immediate)

- **Every dev's Claude Code can search ProzisHUB semantically** — "how does pagination work in services?", "show me the notification email pattern", "what annotations does the batch listener use?"
- Results include exact file paths, line ranges, symbol names, class context, and annotations. Claude Code can navigate directly to the code.
- **Web chat UI** for longer onboarding conversations — new team members ask questions, get answers grounded in actual code with source references.

### After First Nightly Run

- **Automated code review insights** — every merge to develop gets reviewed. Devs can ask "what merged yesterday?" or "were there any issues in recent PRs?"
- **Test suggestions** — AI-generated test ideas for recently changed code. "What should we test after yesterday's merges?"

### Ongoing

- **Index stays fresh automatically** — nightly pipeline pulls latest from develop, diffs changed files, re-indexes only what changed, cleans up deleted files.
- **Zero maintenance per developer** — the pod runs itself. Devs just use it.
- **Shared knowledge base** — standards docs, architecture docs, DB schemas, code patterns — all searchable, all kept in sync.

## Deployment Steps (One-Time, by Infra/DevOps)

```bash
# 1. Provision a pod (4GB RAM, 2 vCPU minimum)

# 2. Clone the repo
git clone <tiburcio-repo> && cd tiburcio

# 3. Configure environment
cp .env.example .env
# Edit .env:
#   - Set database password (openssl rand -hex 16)
#   - Set JWT secret (openssl rand -base64 32)
#   - Set OPENROUTER_API_KEY
#   - Set TEAM_API_KEY (openssl rand -hex 32) — for MCP auth
#   - Set CODEBASE_HOST_PATH to ProzisHUB parent dir
#   - Set CODEBASE_REPOS=api:/codebase/api:develop,ui:/codebase/ui:develop,batch:/codebase/batch:develop

# 4. Build and start
docker compose up -d --build

# 5. Verify
docker compose ps                          # all services healthy
curl https://tiburcio.prozis.internal/api/health  # backend up
docker compose logs -f backend             # watch indexing progress
```

First indexing of ProzisHUB takes ~5-10 minutes depending on repo size. After that, nightly diffs take seconds.

## Security Considerations

| Concern | How It's Handled |
|---------|-----------------|
| Code leaves the network? | Only embedding vectors are sent to OpenRouter. Raw code is stored locally in Qdrant on the pod. `redactSecrets()` strips API keys, passwords, and tokens before any external call. |
| Who can access? | MCP endpoint requires `TEAM_API_KEY`. Web UI requires user registration (bcrypt passwords, httpOnly JWT cookies). |
| Data at rest | All data stays on the pod: PostgreSQL, Redis, Qdrant volumes. Nothing leaves the pod except LLM API calls. |
| Codebase mounted read-only | The `:ro` flag on the Docker volume mount means Tiburcio can never modify source code. |
| HTTPS | Reverse proxy handles TLS termination. All traffic encrypted in transit. |

## FAQ

**Q: What if the pod goes down?**
A: Claude Code MCP calls will fail gracefully — devs just lose semantic search temporarily, their normal workflow is unaffected. Docker restart policy (`unless-stopped`) auto-recovers from crashes. All data is in persistent volumes.

**Q: Can we run this without OpenRouter?**
A: Future version will support Ollama (local LLMs). For now, OpenRouter is required for embeddings and LLM calls. The cost is negligible (~$15/month for the whole team).

**Q: What languages does it index?**
A: Java, TypeScript, Vue SFCs, and SQL — exactly what ProzisHUB uses. AST-based chunking via tree-sitter means functions, classes, and methods are properly bounded, not naively split by line count.

**Q: How fresh is the index?**
A: Nightly pipeline runs at 2 AM (configurable). It diffs from the last indexed commit, re-indexes only changed files, and cleans up deleted files. The index is always within 24 hours of the latest develop branch.

**Q: Does it work with IntelliJ / VS Code / Cursor?**
A: The MCP tools work with any MCP-compatible client (Claude Code, Cursor, etc.). The web UI works in any browser.

**Q: Can multiple teams share one pod?**
A: Currently designed for one codebase per deployment. Multi-repo support is on the roadmap.

## TL;DR

Give us a 4 GB pod. We deploy once. 8 developers get AI-powered codebase search in Claude Code and a web chat UI for onboarding — with zero local setup, zero maintenance, and ~$15/month in API costs. New team members go from "where is anything?" to productive in minutes instead of weeks.
