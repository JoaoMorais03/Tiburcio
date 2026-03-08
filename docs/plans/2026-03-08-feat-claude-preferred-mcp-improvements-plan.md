---
title: "feat: Make Tiburcio Claude's Preferred MCP Buddy"
type: feat
status: active
date: 2026-03-08
---

# Make Tiburcio Claude's Preferred MCP Buddy

## Overview

After real-world testing all 10 Tiburcio tools, this plan captures what Claude Code (the actual user) needs changed to prefer Tiburcio over built-in tools (Read, Grep, Glob). Current score: 7/10. Target: 9/10.

## The Honest Problem

Claude Code already has powerful built-in tools:
- `Read` — instant file reading
- `Grep` — regex search across entire codebase in milliseconds
- `Glob` — find files by pattern
- `CLAUDE.md` — loaded automatically into every conversation

For a 96-file codebase, these native tools are **faster** than Tiburcio for most queries. Tiburcio adds ~1-2s latency per call (OpenRouter embedding round-trip). So why would Claude prefer Tiburcio?

**Tiburcio wins when it provides something Grep/Read CAN'T do:**
1. Semantic understanding (not just keyword matching)
2. Pre-digested context (conventions, patterns, architecture as structured answers)
3. Overnight intelligence (reviews, test suggestions, change summaries)
4. Cross-file relationship awareness

**Tiburcio loses when it's just a slower version of Grep.**

## What Needs to Change

### P1 — Fix Immediately (blocks adoption)

#### 1. searchCode compact mode is useless — show actual code

**Problem:** Compact mode returns `symbolName: "cookieAuth"` with a one-line summary. Claude still needs to `Read` the file to see the code. This makes the tool a slower version of Grep — it tells Claude WHERE the code is but not WHAT it is.

**Fix:** Compact mode should include the first 15-20 lines of code (enough to understand the function signature and key logic), not just a summary string. The summary field should be the function signature, not a truncated comment.

**Files:** `backend/src/mastra/tools/search-code.ts`, `backend/src/mastra/tools/truncate.ts`

#### 2. Too many header/import chunks pollute search results

**Problem:** Searching "embedding model provider factory" returned 8 results. 3 of them were just import headers from unrelated tool files (`get-architecture.ts`, `get-test-suggestions.ts`, `search-schemas.ts`). These share the same import pattern (`import { embedText }`) so they match, but they're noise — Claude doesn't need to see imports to understand how embedding works.

**Fix:** Either (a) downrank `chunkType: "header"` results by 50% in the scoring, or (b) filter them out when a non-header result from the same file exists, or (c) don't return header chunks unless specifically requested.

**Files:** `backend/src/mastra/tools/search-code.ts`

#### 3. Run nightly pipeline on-demand (not just 2 AM cron)

**Problem:** 3 out of 10 tools (`getNightlySummary`, `getChangeSummary`, `searchReviews`) return empty results until the nightly pipeline runs. A user who just set up Tiburcio sees 30% of tools as broken. The value proposition collapses.

**Fix:** Add an `index-nightly` job type that can be triggered on-demand via the admin API or CLI. First boot should run the nightly review immediately after codebase indexing completes (not wait until 2 AM). Even a "lite" review of the last 5 commits would populate these collections.

**Files:** `backend/src/jobs/queue.ts`, `backend/src/server.ts`

### P1.5 — Enable Neo4j Graph Layer (already built, just needs wiring)

#### 4. Neo4j setup + auto-build on first boot

**Problem:** The graph layer is 100% implemented (`graph/client.ts`, `graph/extractor.ts`, `graph/builder.ts`) and the `getImpactAnalysis` tool works — but nobody can use it because:
- Neo4j is hidden behind a Docker Compose profile (`--profile graph`)
- No env vars are set by default
- The graph is only built during nightly pipeline, so first-timers get `{ available: false }`
- The `.env.example` doesn't even mention `NEO4J_PASSWORD`

**My honest buyer opinion:** This is the one tool that Grep genuinely **cannot** replicate. When I need to refactor `getEmbeddingModel()`, Grep tells me 14 files import it. But it can't tell me the *call chain* — that `mcp.ts` → `registerTools()` → `search-code.ts` → `embedText()` → `getEmbeddingModel()` is 3 levels deep, while `index-codebase.ts` calls it directly. Neo4j answers "what's the blast radius?" in one query. That's worth the ~200MB RAM.

**What's already built:**
- `graph/client.ts` — lazy driver init, `isGraphAvailable()`, `runCypher()`, schema constraints for File/Function/Class/Table
- `graph/extractor.ts` — regex-based extraction of IMPORTS, CALLS, EXTENDS, QUERIES relationships (TypeScript + Java)
- `graph/builder.ts` — full graph rebuild with batch UNWIND inserts, .tibignore support, <5s target
- `get-impact-analysis.ts` — Cypher queries for file/function/class/table impact, graceful degradation
- `docker-compose.yml` — `neo4j` service already defined with `profiles: ["graph"]`

**What needs to change:**

1. **Auto-build graph after codebase indexing completes** — add a `buildGraph()` call at the end of the codebase indexing job in `queue.ts`, gated by `isGraphAvailable()`. Currently the graph only builds during the nightly pipeline.

2. **Add Neo4j env vars to `.env.example`** with clear comments:
   ```
   # Optional: Neo4j graph for impact analysis (getImpactAnalysis tool)
   # Start with: docker compose --profile graph up -d
   # NEO4J_URI=bolt://localhost:7687
   # NEO4J_PASSWORD=tiburcio
   ```

3. **Docker networking fix** — when backend runs in Docker, `NEO4J_URI` must point to `bolt://neo4j:7687` (service name), not `localhost`. Add override in docker-compose.yml backend environment section (same pattern as REDIS_URL/QDRANT_URL).

4. **Document in README** — add Neo4j to the "What You Can Explore" table (http://localhost:7474 browser) and to the Services table.

**Cost:** ~200MB RAM for Neo4j Community. Zero API calls. Graph build is <5s per repo.

**Files:** `backend/src/jobs/queue.ts`, `.env.example`, `docker-compose.yml`, `README.md`

**Verdict:** Enable it. The code is done, the infra cost is trivial, and it's the only tool that answers "what breaks if I change X?" — which is the question I ask most before refactoring.

### P2 — High Impact (makes Claude prefer Tiburcio)

#### 5. Add a "context bundle" meta-tool (was P2.4)

**Problem:** When Claude starts working on a feature (e.g., "add a new MCP tool"), it needs to call 4 tools sequentially: `searchStandards` → `getPattern` → `searchCode` → `getArchitecture`. That's 4 round-trips, 4-8 seconds of latency, and Claude has to figure out which tools to call.

**Fix:** Add an 11th tool: `getContext(query, scope?)` that automatically calls the most relevant subset of tools based on the query and returns a combined response. Example:

```
getContext("add a new MCP tool")
→ Returns: relevant standard (backend conventions) + pattern (new-api-endpoint)
  + 2 code examples (existing tools) + architecture context (MCP transport)
```

This is the killer feature. One call, ~2 seconds, complete context. Claude doesn't have to orchestrate 4 tools.

**Files:** New tool `backend/src/mastra/tools/get-context.ts`, update `backend/src/mcp-tools.ts`

#### 6. Add "find usages / who calls this?" capability

**Problem:** Claude can `Grep` for a function name, but Grep doesn't understand import chains. If Claude asks "what breaks if I change `getEmbeddingModel()`?", Grep returns every file that imports it, but doesn't show the call chain or distinguish between direct callers and transitive dependents.

**Current state:** `getImpactAnalysis` exists and works with Neo4j (P1.5 enables it). But for users without Neo4j, a lightweight fallback using indexed chunk metadata would still add value.

**Fix:** Add a lightweight "find usages" mode to `searchCode` that doesn't require Neo4j. Parse `import` statements from the indexed chunks to build a basic dependency map. When a user queries "who uses embedText", return the files that import and call it, ordered by coupling strength. If Neo4j is available, delegate to `getImpactAnalysis` for deeper traversal.

**Files:** `backend/src/mastra/tools/search-code.ts` (add `mode: "usages"` parameter)

#### 7. Convention checker tool — "does this code match our standards?"

**Problem:** `searchStandards` returns conventions. But Claude has to manually compare its proposed code against those conventions. There's no tool that says "here's my code, does it match?"

**Fix:** Add `checkConventions(code, language)` tool that takes a code snippet, searches relevant standards, and returns a pass/fail with specific violations. This turns Tiburcio from a passive reference into an active assistant.

Example:
```
checkConventions(`
  app.get("/users", async (c) => {
    const users = await db.select().from(usersTable);
    return c.json(users);
  });
`, "typescript")

→ { pass: false, violations: [
    "Missing error handling (convention: always catch errors in route handlers)",
    "Missing pagination (convention: never return unbounded results)",
    "Missing auth middleware (convention: add JWT middleware for protected endpoints)"
  ]}
```

**Files:** New tool `backend/src/mastra/tools/check-conventions.ts`

### P3 — Nice to Have (polish)

#### 8. Stale result indicator

When `searchCode` returns a result, include a `lastIndexed` timestamp. If the file was modified after indexing, mark it as `stale: true`. Claude then knows to `Read` the current version instead of trusting the cached result.

#### 9. Better tool descriptions for Claude's tool selection

The current tool descriptions are good but could include "prefer this over Grep when..." hints. Example: `searchCode` description could say "Use for semantic/conceptual queries. For exact string matching, use Grep instead." This helps Claude's tool selection logic.

#### 10. searchStandards should link to patterns

When `searchStandards` returns "use Drizzle for all database operations", it should also mention "see pattern: new-api-endpoint for a working example". Cross-linking between tools reduces the number of follow-up calls.

## Cloud Deployment Gotchas (Lightsail, ECS, K8s pods)

The same Docker networking issues we hit locally will bite harder in cloud:

1. **Service discovery** — In Docker Compose, services reach each other by name (`redis`, `qdrant`, `neo4j`). In K8s, they use ClusterIP DNS. In single-VM Lightsail, everything is `localhost`. The docker-compose.yml environment overrides handle this for Compose, but cloud deployments need their own env config.

2. **MCP transport** — SSE won't work (OAuth). SSH stdio works for any server with SSH access. For K8s pods without SSH, you'd need to either:
   - Expose an SSH sidecar container, or
   - Wait for MCP spec to support non-OAuth HTTP auth, or
   - Use a tunneling tool (e.g., Cloudflare Tunnel) to expose stdio over a secure channel

3. **Persistent volumes** — Qdrant and Neo4j need persistent storage. On Lightsail, bind mounts work. On K8s, use PersistentVolumeClaims. Losing Qdrant data means re-indexing (~12 min per 100 files).

4. **Memory** — Minimum viable setup: ~2GB RAM (backend 1G + Qdrant 256M + Redis 128M + Postgres 512M). With Neo4j add 768M. A Lightsail 4GB instance ($24/mo) handles everything comfortably.

5. **Codebase access** — The backend needs read access to the git repo. On Lightsail, clone the repo and set `CODEBASE_HOST_PATH`. On K8s, mount the repo as a volume or use a git-sync sidecar.

**Bottom line:** Lightsail is the easiest cloud path — it's just Docker Compose on a VM. K8s adds complexity (service discovery, volumes, no SSH stdio) but is doable. The SSH stdio approach for MCP is the key insight that makes remote deployment work without OAuth.

## What NOT to Change

- **Don't add more collections** — 6 is enough. More collections = more indexing time = more cost.
- **Don't add a chat/conversation layer** — Tiburcio is a tool provider, not a chat replacement. Keep it focused.
- **Don't try to replace Grep/Read** — they're faster for exact matches. Tiburcio should complement them, not compete.
- **Don't add OAuth** — stdio + SSH is simpler and works. OAuth adds complexity for zero benefit in this use case.

## Priority Order

1. **Fix compact mode** (P1.1) — biggest bang for buck, makes searchCode actually useful
2. **Filter header chunks** (P1.2) — reduces noise immediately
3. **On-demand nightly** (P1.3) — unlocks 3 dead tools
4. **Enable Neo4j** (P1.5.4) — zero code to write, just wire up env + auto-build. Unlocks the only tool Grep can't replicate
5. **Context bundle tool** (P2.5) — the killer feature
6. **Convention checker** (P2.7) — transforms Tiburcio from passive to active
7. **Find usages** (P2.6) — unique value Grep can't provide (enhanced if Neo4j is available)

## Success Criteria

- [ ] Claude Code uses Tiburcio tools in >50% of code-related queries (currently ~20%)
- [ ] All 10 tools return useful data on first boot (not just after nightly runs)
- [ ] Average response time <2 seconds per tool call
- [ ] `searchCode` compact mode returns enough code to avoid a follow-up `Read` call 80% of the time
- [ ] A new developer can set up and test Tiburcio in <15 minutes (documented in README)

## Cost Impact

All changes are server-side (backend TypeScript). Infrastructure additions:
- P1.5 (Neo4j) adds ~200MB RAM container. Zero API calls. Graph build <5s per repo. Community edition is free.
- P2.6 (find usages without Neo4j) uses indexed chunk metadata — no new infra
- P2.7 (convention checker) adds one LLM call per check — ~$0.001 per call on OpenRouter

## Acceptance Criteria

- [ ] searchCode compact returns 15-20 lines of actual code per result
- [ ] Header chunks don't appear in top 3 results when better matches exist
- [ ] Nightly review runs on first boot after indexing completes
- [ ] Neo4j auto-builds graph after codebase indexing (when NEO4J_URI is set)
- [ ] `getImpactAnalysis` returns real dependency data on first boot (not just after nightly)
- [ ] Neo4j env vars documented in `.env.example` with clear setup instructions
- [ ] Docker networking works for Neo4j (bolt://neo4j:7687 override in docker-compose.yml)
- [ ] getContext meta-tool returns combined results in a single call
- [ ] Convention checker validates code against indexed standards
- [ ] README documents complete setup in 5 steps (+ optional Neo4j step)
- [ ] All changes pass `pnpm check && pnpm test`
