# Tiburcio v2.0 — Developer Intelligence MCP

## What This Document Is

Active roadmap for Tiburcio v2. Replaces `FUTURE_IMPROVEMENTS.md`. Informed by running v1.2.1 with 7 MCP tools under real Claude Code usage.

**Status**: v2.0.0 shipped. Pillars 2-5 partially implemented. Remaining items tracked below.

---

## What We Learned from v1.x

### What works well
- **Nightly reviews + test suggestions** are the unique killer feature. No other tool provides automated code review of daily merges with convention-aware feedback. This is the feature that actually helps developers catch bugs.
- **searchStandards** enforces team consistency. When Claude Code checks "is this how the team does error handling?" before writing code, it prevents inconsistency before code review. Real value at scale.
- **getPattern** ensures new endpoints, pages, and batch jobs follow the team template. Small but real consistency win.
- **searchSchemas** gives clean, structured database documentation. New devs get instant answers about table relationships.
- **Hybrid search (dense + BM25 RRF)** on code-chunks works well. Keyword-exact matches and semantic matches together.
- **Tool descriptions and cross-tool routing** — Claude Code almost always picks the right tool on the first try.
- **Payload truncation** keeps responses focused without drowning the context window.

### What doesn't work
- **searchCode is marginal over Claude Code's native tools.** For developers who know the codebase, `grep + read` gets the same results in ~30 seconds more, and the results are always fresh. Tiburcio's semantic advantage only shows for vague queries ("how do we handle errors?"), not targeted ones ("find the auth middleware"). searchCode should exist but is not the headline feature.
- **Stale vectors are the #1 trust killer.** With 8 devs pushing code daily, search results contain deleted files and old implementations within hours of the nightly reindex. A developer who gets stale results once stops trusting the tool entirely. Nightly-only indexing is not frequent enough for an active team.
- **getArchitecture area filters are fragile.** The `area: "batch"` filter returned zero results even though the nightly pipeline is a core feature. Advertised filters that return nothing erode trust.
- **searchStandards misses common questions.** "How should I write tests?" returned collection metadata instead of testing conventions. This is partly a content gap, partly a search precision issue.
- **2 of 7 tools return nothing on first boot.** searchReviews and getTestSuggestions depend on the nightly pipeline having run. 30% of the tool surface is empty for new deployments.
- **getPattern shipped broken.** The `process.cwd()` path resolution bug meant it returned "not found" for every query in MCP mode. Unit tests passed but the tool failed in production. No end-to-end smoke test caught this.
- **No freshness indicator.** Developers have no way to know if search results are 1 hour or 24 hours old. No way to know if the index is stale.

### The hard truth for 8 experienced devs
For daily "catch bugs and ship code" work, Claude Code's native grep/read/bash tools get developers 80% of what they need — always fresh, zero infrastructure. Tiburcio's value for this audience is:
- **40% nightly intelligence** (reviews, test suggestions, change summaries)
- **30% standards and convention enforcement** (searchStandards, getPattern, convention scoring)
- **20% onboarding acceleration** (for new team members, not daily use)
- **10% semantic code search** (marginal over native tools)

v2 is built around this reality.

---

## Philosophy Shift

### v1.x: "Onboarding Knowledge System"
Passive — waits for questions, returns search results. Focuses on answering "how do we do things here?" Value diminishes as developers learn the codebase.

### v2.0: "Team Intelligence Engine"
Active — catches problems, enforces standards, surfaces insights proactively. Focuses on "what should I know right now?" Value increases as the codebase grows and changes.

| Aspect | v1.x | v2.0 |
|--------|------|------|
| Primary interface | Chat UI + MCP tools | MCP tools (shared pod) |
| Indexing trigger | Nightly only | Event-driven (webhook) + nightly |
| Freshness guarantee | ~24 hours | ~5-10 minutes after push |
| Convention enforcement | None (search only) | Active scoring + drift tracking |
| Change awareness | None | "What did I miss?" summaries |
| Deployment model | Per-developer local | One shared pod for the team |
| Headline feature | Code search | Nightly intelligence + convention guardian |

---

## v2.0 Pillars

### Pillar 1: Event-Driven Freshness

**Problem**: Nightly indexing means vectors are stale for up to 24 hours. With 8 active developers, search results become untrustworthy within hours of the reindex.

**Solution**: Webhook-triggered incremental indexing on every push to the tracked branches.

#### 1.1 Webhook Endpoint

New endpoint: `POST /api/webhooks/push`

```typescript
// Accepts GitHub and GitLab webhook payloads
// Validates HMAC signature (WEBHOOK_SECRET)
// Extracts: repo name, branch, changed files, deleted files
// Queues a BullMQ job: "incremental-index"
```

Supported webhook providers:
- **GitHub**: `X-Hub-Signature-256` header, `push` event
- **GitLab**: `X-Gitlab-Token` header, `push_events` webhook

The incremental-index job reuses the exact same logic as the nightly pipeline's step 1 (`incremental-reindex`), but scoped to the files listed in the webhook payload instead of doing a full `git diff`.

#### 1.2 Freshness Tracking

Every Qdrant collection stores a `lastIndexedAt` timestamp in Redis:
```
tiburcio:collection-updated:{collectionName} → ISO timestamp
tiburcio:collection-updated:code-chunks → "2026-02-25T14:32:00Z"
tiburcio:collection-updated:standards → "2026-02-25T02:00:00Z"
```

New tool `getIndexStatus` exposes this to developers (see Pillar 5).

#### 1.3 Freshness Guarantee

| Trigger | Latency | Scope |
|---------|---------|-------|
| Webhook (push) | ~2-5 min | Changed files only |
| Nightly (2 AM cron) | Full cycle | All collections + reviews + test suggestions |

The nightly pipeline remains for: full consistency checks, code reviews, test suggestions, and convention scoring. Webhooks handle freshness for code-chunks only.

#### New Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WEBHOOK_SECRET` | Yes (if webhooks enabled) | HMAC secret for GitHub/GitLab signature validation |

#### New Files

| File | Purpose |
|------|---------|
| `backend/src/routes/webhooks.ts` | Webhook endpoint, signature validation, payload parsing |
| `backend/src/indexer/webhook-handler.ts` | Extracts changed files from webhook payload, queues incremental job |

---

### Pillar 2: Nightly Intelligence Engine

**Problem**: searchReviews and getTestSuggestions are the unique killer features but are underemphasized. The nightly pipeline runs but its outputs aren't surfaced proactively.

**Solution**: Enhance the nightly pipeline with convention scoring and change summaries. Make intelligence outputs the primary value proposition.

#### 2.1 Convention Adherence Scoring

Enhance the code review agent to produce a convention score per merge:

```typescript
interface ConventionScore {
  commitSha: string;
  repo: string;
  author: string;
  date: string;
  score: number;           // 0-100
  violations: string[];    // specific standards violated
  filesReviewed: number;
}
```

The review agent already analyzes merges against standards. v2 adds structured scoring:
- Compare each changed file against relevant standards from the `standards` collection
- Score: percentage of checked conventions that pass
- Track scores in a new `convention-scores` Qdrant collection
- Enables drift detection over time

#### 2.2 Standards Drift Report

New weekly BullMQ cron job (`"0 3 * * 1"` — Monday 3 AM):

1. Query all `reviews` from the past week with `category: "convention"`
2. Group by standard violated
3. Produce a summary: "Top convention violations this week: 1. Missing Zod validation (5 occurrences), 2. Raw SQL instead of Drizzle (3 occurrences)"
4. Store the report in the `reviews` collection with `category: "drift-report"`

#### 2.3 Change Summary Generation

After the nightly review completes, generate a human-readable summary:
- Group review notes by area (auth, payments, frontend, etc.)
- Highlight breaking changes, security concerns, and convention violations
- Store as a `change-summary` document in the `reviews` collection

This powers the new `getChangeSummary` tool (see Pillar 5).

#### New Qdrant Collection

| Collection | Vectors | Purpose |
|------------|---------|---------|
| `convention-scores` | Dense only, 4096-dim | Convention adherence scores over time |

#### Modified Files

| File | Changes |
|------|---------|
| `mastra/workflows/nightly-review.ts` | Add convention scoring to review step, add change summary generation |
| `mastra/agents/code-review-agent.ts` | Enhanced prompt for convention scoring output format |
| `jobs/queue.ts` | Add weekly drift report cron job |

---

### Pillar 3: Shared Team Deployment

**Problem**: 8 developers running 6 containers each = 32 GB RAM wasted, 8 independent indexes of the same codebase, inconsistent freshness.

**Solution**: One pod, HTTP/SSE MCP transport, git clone support.

#### 3.1 HTTP/SSE MCP Transport

Add an SSE endpoint to the existing Hono server:

```typescript
// backend/src/routes/mcp.ts
// Mounts at /mcp
// SSE transport (MCP SDK supports this natively)
// Bearer auth: Authorization: Bearer <TEAM_API_KEY>
```

Developer setup (one command):
```bash
claude mcp add tiburcio \
  --transport sse \
  --url https://tiburcio.internal/mcp \
  --header "Authorization:Bearer <team-api-key>"
```

The stdio transport remains for local development. Both transports expose the same tools.

#### 3.2 Git Clone Manager

Replace local filesystem paths with git clone support:

```typescript
// backend/src/indexer/git-manager.ts

// CODEBASE_REPOS format (v2):
// name:source:branch
// where source is a local path (starts with /) or a git URL (starts with https://)

// Examples:
// Local:  api:/codebase/api:develop
// Remote: api:https://github.com/org/api.git:develop
// Mixed:  api:/local/api:develop,ui:https://github.com/org/ui.git:main
```

For remote repos:
- Clone into `/data/repos/{name}/` on first boot
- `git fetch origin && git reset --hard origin/{branch}` before each index run
- `GIT_TOKEN` env var for private repo authentication (used as `https://token@github.com/...`)
- Clone is read-only — never push, never modify

#### 3.3 Reverse Proxy

Add Caddy to `docker-compose.yml` for automatic TLS:

```yaml
caddy:
  image: caddy:2-alpine
  ports:
    - "443:443"
    - "80:80"  # redirect to HTTPS
  volumes:
    - ./Caddyfile:/etc/caddy/Caddyfile
    - caddy_data:/data
```

#### New Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TEAM_API_KEY` | Yes (shared pod) | Bearer token for MCP HTTP auth |
| `GIT_TOKEN` | If remote repos | Git auth token for private repos |
| `MCP_TRANSPORT` | No (default: both) | `stdio`, `http`, or `both` |

#### New Files

| File | Purpose |
|------|---------|
| `backend/src/routes/mcp.ts` | HTTP/SSE MCP endpoint with Bearer auth |
| `backend/src/indexer/git-manager.ts` | Clone, pull, and manage remote repos |
| `Caddyfile` | Reverse proxy config for HTTPS termination |

---

### Pillar 4: Convention Guardian

**Problem**: Standards docs exist but nobody checks if new code follows them. Convention drift is invisible until it's a big problem.

**Solution**: Active convention monitoring with scoring, tracking, and reporting.

#### 4.1 How It Works

The Convention Guardian is not a separate service — it's an enhancement to the existing nightly pipeline:

1. **Nightly review** already reads changed files and reviews them against standards
2. v2 adds structured convention scoring to each review (Pillar 2.1)
3. Scores are stored in `convention-scores` collection with timestamps
4. New tool `getConventionReport` queries scores over time
5. Weekly drift report surfaces trends (Pillar 2.2)

#### 4.2 Convention Score Lifecycle

```
Push to develop
    │
    ▼
Nightly pipeline runs
    │
    ▼
Code review agent reviews each merge
    │
    ├── Produces review notes (existing)
    │
    └── Produces convention score per merge (NEW)
         │
         ├── Score stored in convention-scores collection
         │
         └── If score < threshold → flagged in review notes
              │
              ▼
         Weekly drift report aggregates trends
              │
              ▼
         getConventionReport tool surfaces to devs
```

#### 4.3 Future: PR Integration (Optional, Post-v2.0)

Real-time convention feedback on PRs:
- GitHub/GitLab webhook on PR creation
- Trigger convention review immediately (not waiting for nightly)
- Post review comments directly on the PR via API
- Scoped to convention violations only (not subjective style)

This is explicitly out of scope for v2.0 but the architecture supports it.

---

### Pillar 5: Tool Surface

v2.0 expands from 7 to 10 tools.

#### New Tools (3)

##### `getChangeSummary`

"What did I miss?" — the most requested onboarding feature.

```typescript
export const getChangeSummary = createTool({
  id: "getChangeSummary",
  description:
    "Generate a summary of what changed in the codebase over a time period. " +
    "For developers returning from vacation, switching projects, or catching up on recent work. " +
    "Groups changes by area and severity. For detailed review notes, use searchReviews.",
  inputSchema: z.object({
    since: z
      .string()
      .describe("How far back to summarize: '1d', '3d', '7d', '2w', or ISO date"),
    area: z
      .string()
      .optional()
      .describe("Focus area, e.g. 'auth', 'payments', 'frontend'. Omit for all areas."),
    repo: z
      .string()
      .optional()
      .describe("Filter by repository name. Omit to include all repos."),
  }),
});
```

Implementation: Queries the `reviews` collection with a date filter, groups by area and severity, returns a structured summary.

##### `getConventionReport`

Convention adherence over time.

```typescript
export const getConventionReport = createTool({
  id: "getConventionReport",
  description:
    "Get convention adherence trends for the codebase. " +
    "Shows which standards are being followed and which are drifting. " +
    "For specific convention violations, use searchReviews with category 'convention'.",
  inputSchema: z.object({
    period: z
      .string()
      .optional()
      .describe("Time period: '7d', '30d', '90d'. Default: '30d'."),
    repo: z
      .string()
      .optional()
      .describe("Filter by repository name. Omit for all repos."),
  }),
});
```

Implementation: Queries the `convention-scores` collection, aggregates by period, returns trends and top violations.

##### `getIndexStatus`

Freshness and trust indicator.

```typescript
export const getIndexStatus = createTool({
  id: "getIndexStatus",
  description:
    "Check when each knowledge base collection was last indexed. " +
    "Use this to verify data freshness before relying on search results. " +
    "If an index is stale, consider that results may not reflect recent changes.",
  inputSchema: z.object({}),
});
```

Implementation: Reads `tiburcio:collection-updated:*` keys from Redis, returns timestamps and staleness indicators for each collection.

#### Modified Tools

| Tool | Change |
|------|--------|
| `searchCode` | Add `lastIndexed` timestamp to response. Add `staleness` field ("fresh", "recent", "stale"). |
| `searchReviews` | Add `since` date filter parameter. Support `category: "drift-report"` for weekly summaries. |
| `getTestSuggestions` | Add `since` date filter parameter. |
| All 10 tools | Standardize error responses with recovery guidance. |

#### Unchanged Tools

| Tool | Why unchanged |
|------|--------------|
| `searchStandards` | Works well. Content gaps are a docs problem, not a tool problem. |
| `getArchitecture` | Works well when filters aren't used. (Fix: validate area filter against actual indexed areas.) |
| `searchSchemas` | Works well. Clean structured output. |
| `getPattern` | Works well after the v1.2.1 path fix. |

#### Tool Summary (v2.0)

| # | Tool | Collection | Priority | Category |
|---|------|-----------|----------|----------|
| 1 | `searchReviews` | reviews | **Primary** | Intelligence |
| 2 | `getTestSuggestions` | test-suggestions | **Primary** | Intelligence |
| 3 | `getChangeSummary` | reviews | **Primary** | Intelligence |
| 4 | `getConventionReport` | convention-scores | **Primary** | Guardian |
| 5 | `searchStandards` | standards | Secondary | Knowledge |
| 6 | `getPattern` | filesystem | Secondary | Knowledge |
| 7 | `searchCode` | code-chunks | Secondary | Search |
| 8 | `getArchitecture` | architecture | Secondary | Knowledge |
| 9 | `searchSchemas` | schemas | Secondary | Knowledge |
| 10 | `getIndexStatus` | Redis | Utility | Trust |

---

## Architecture Changes

### New Components

```
                                   ┌──────────────────────────────────┐
                                   │         Tiburcio v2 Pod          │
                                   │                                  │
  GitHub/GitLab ──webhook──►       │  ┌─── Caddy (TLS) ───────────┐  │
                                   │  │                            │  │
  Dev Claude Code ──MCP/SSE──►     │  │  /mcp  → MCP SSE Handler  │  │
                                   │  │  /api   → Hono Backend     │  │
  Dev Browser ──HTTPS──►           │  │  /      → Frontend (SPA)   │  │
                                   │  │  /webhooks → Webhook Handler│  │
                                   │  └────────────────────────────┘  │
                                   │                                  │
                                   │  ┌─ Backend ──────────────────┐  │
                                   │  │ Hono Server                │  │
                                   │  │ MCP Server (SSE + stdio)   │  │
                                   │  │ BullMQ Worker              │  │
                                   │  │ Git Manager (clone/pull)   │  │
                                   │  └────────────────────────────┘  │
                                   │                                  │
                                   │  Qdrant (7 collections)          │
                                   │  PostgreSQL 17                   │
                                   │  Redis                           │
                                   └──────────────────────────────────┘
```

### Qdrant Collections (v2.0)

| Collection | Vectors | New? | Purpose |
|------------|---------|------|---------|
| `standards` | Dense | No | Team conventions and coding standards |
| `code-chunks` | Dense + BM25 | No | Source code with hybrid search |
| `architecture` | Dense | No | System architecture docs |
| `schemas` | Dense | No | Database schema docs |
| `reviews` | Dense | No | Nightly review notes + change summaries + drift reports |
| `test-suggestions` | Dense | No | AI-generated test scaffolds |
| `convention-scores` | Dense | **Yes** | Convention adherence scores over time |

### Redis Keys (v2.0)

| Key Pattern | New? | Purpose |
|-------------|------|---------|
| `tiburcio:codebase-head:{repo}` | No | Last indexed git SHA per repo |
| `tiburcio:embedding-model` | No | Current embedding model (auto-reindex on change) |
| `tiburcio:collection-updated:{name}` | **Yes** | Last index timestamp per collection |
| `refresh:{jti}` | No | Revoked refresh tokens |

### BullMQ Jobs (v2.0)

| Job | Trigger | New? | What it does |
|-----|---------|------|-------------|
| `index-standards` | Nightly 2 AM + startup | No | Full re-index of standards/ |
| `index-architecture` | Nightly 2 AM + startup | No | Full re-index of architecture + schemas |
| `index-codebase` | Startup (if empty) | No | Full initial index of all repos |
| `nightly-review` | Nightly 2 AM | Modified | Incremental reindex + review + convention scoring + test suggestions + change summary |
| `incremental-index` | Webhook | **Yes** | Index changed files from webhook payload |
| `weekly-drift-report` | Monday 3 AM | **Yes** | Aggregate convention violations into drift report |

---

## New File Layout (v2.0 additions)

```
backend/src/
  routes/
    webhooks.ts           # NEW — POST /api/webhooks/push (GitHub/GitLab)
    mcp.ts                # NEW — GET /mcp (SSE transport, Bearer auth)
  indexer/
    git-manager.ts        # NEW — clone, pull, manage remote repos
    webhook-handler.ts    # NEW — parse webhook payloads, queue incremental jobs
  mastra/
    tools/
      get-change-summary.ts   # NEW — "what did I miss?" tool
      get-convention-report.ts # NEW — convention adherence trends
      get-index-status.ts      # NEW — freshness indicator
  scripts/
    smoke-test.ts         # NEW — end-to-end tool validation
Caddyfile                 # NEW — reverse proxy config
```

---

## Smoke Test Suite

Prevents shipping broken tools. Runs after indexing completes.

```typescript
// scripts/smoke-test.ts
// For each of the 10 tools:
//   1. Call with a known good query
//   2. Assert response is non-empty
//   3. Assert expected fields are present
//   4. Log pass/fail
//
// Exit code 0 = all tools working
// Exit code 1 = at least one tool broken
//
// Usage: pnpm smoke-test
// Can be added to CI after docker compose up
```

Example checks:
- `searchStandards({ query: "error handling" })` → must return results with `content` field
- `searchCode({ query: "authentication" })` → must return results with `filePath` and `code` fields
- `getPattern({})` → must return `patterns[]` array with at least 1 entry
- `getIndexStatus({})` → must return timestamps for all collections
- `searchReviews({ query: "recent changes" })` → allowed to be empty (depends on nightly), but must not error

---

## Migration Path (v1.2.x → v2.0)

### Breaking Changes

| Change | Impact | Migration |
|--------|--------|-----------|
| New Qdrant collection: `convention-scores` | None (auto-created on startup) | Automatic |
| New Redis keys: `collection-updated:*` | None (populated on first index) | Automatic |
| New env vars: `WEBHOOK_SECRET`, `TEAM_API_KEY` | Required for new features | Add to `.env` |
| `CODEBASE_REPOS` URL support | Backwards compatible (local paths still work) | No change needed |
| HTTP MCP transport | Additive (stdio still works) | `claude mcp add` with new URL |
| 3 new tools | Additive | Auto-available via MCP |

### Non-Breaking

All existing tools, collections, and configurations continue to work. v2.0 is additive — nothing is removed.

### Upgrade Steps

1. Pull latest code
2. Add new env vars to `.env` (`WEBHOOK_SECRET`, `TEAM_API_KEY`)
3. `docker compose up -d --build`
4. New collection auto-created, new tools auto-available
5. Configure webhook in GitHub/GitLab (optional)
6. Developers update MCP config to use HTTP transport (optional)

---

## Implementation Phases

### Phase A: Event-Driven Freshness (Pillar 1)

**Effort**: Medium | **Impact**: High | **Priority**: First

1. Implement `routes/webhooks.ts` — webhook endpoint with HMAC validation
2. Implement `indexer/webhook-handler.ts` — payload parsing for GitHub and GitLab
3. Add `incremental-index` BullMQ job type to `queue.ts`
4. Add `collection-updated` Redis timestamp tracking to all indexers
5. Implement `getIndexStatus` tool
6. Add `lastIndexed` and `staleness` fields to searchCode responses
7. Tests for webhook validation, payload parsing, incremental indexing

### Phase B: Nightly Intelligence Enhancements (Pillar 2)

**Effort**: Medium | **Impact**: High | **Priority**: Second

1. Add convention scoring to nightly review agent prompt
2. Create `convention-scores` collection and indexing logic
3. Implement change summary generation in nightly pipeline
4. Implement `getChangeSummary` tool
5. Implement `getConventionReport` tool
6. Add `since` date filter to `searchReviews` and `getTestSuggestions`
7. Add weekly drift report cron job
8. Tests for convention scoring, change summaries, drift reports

### Phase C: Shared Team Deployment (Pillar 3)

**Effort**: Medium-High | **Impact**: High | **Priority**: Third

1. Implement `routes/mcp.ts` — HTTP/SSE MCP endpoint with Bearer auth
2. Implement `indexer/git-manager.ts` — clone and pull logic
3. Extend `CODEBASE_REPOS` parsing to support URLs
4. Add Caddy to `docker-compose.yml` with Caddyfile
5. Update `.env.example` with new variables
6. Write deployment guide for shared pod setup
7. Tests for git-manager, MCP HTTP transport auth

### Phase D: Quality & Polish

**Effort**: Low | **Impact**: Medium | **Priority**: Fourth

1. Implement `scripts/smoke-test.ts`
2. Fix getArchitecture area filter (validate against indexed areas)
3. Add `pnpm smoke-test` script to package.json
4. Update CLAUDE.md, README.md, CONTRIBUTING.md, CHANGELOG.md
5. Update ProzisTiburcioPod.md to reflect implemented features
6. Update version to 2.0.0 across all files

---

## Success Metrics

How we know v2 is working:

| Metric | Target | How to measure |
|--------|--------|----------------|
| Index freshness | < 10 min after push | `getIndexStatus` timestamps |
| Convention score visibility | Every merge scored | `getConventionReport` returns data |
| Tool reliability | 10/10 tools return results | Smoke test passes |
| Developer adoption | 8/8 devs connected via MCP | Server access logs |
| Setup time for new dev | < 2 minutes | One `claude mcp add` command |
| Nightly pipeline success rate | > 95% | BullMQ job completion logs |
| Stale result complaints | Zero | Developer feedback |

---

## What v2.0 is NOT

Tiburcio is **not** trying to be:
- **A code editing agent** — Claude Code already does that
- **A CI/CD pipeline** — GitHub Actions already does that
- **A generic AI chatbot** — ChatGPT already does that
- **A project management tool** — Jira already does that
- **A replacement for Claude Code's native search** — grep + read are fine for targeted queries

Tiburcio v2 is a **team intelligence engine** that:
1. Keeps knowledge fresh (event-driven indexing)
2. Catches problems overnight (nightly reviews + convention scoring)
3. Surfaces what matters (change summaries + drift reports)
4. Enforces consistency (standards + patterns + convention guardian)
5. Works for the whole team from one deployment (shared pod + HTTP MCP)

That's the focus. That's the mission.

---

## Implementation Status (v2.0.0)

| Feature | Status | Notes |
|---------|--------|-------|
| **Ollama local inference** | Done | `MODEL_PROVIDER=ollama`, `@ai-sdk/openai-compatible` |
| **Compact mode (all tools)** | Done | Default `compact: true`, 300-1,500 tokens/call |
| **getNightlySummary tool** | Done | Morning briefing from nightly pipeline |
| **getChangeSummary tool** | Done | "What did I miss?" grouped by area/severity |
| **`since` date filter** | Done | On searchReviews and getTestSuggestions |
| **HTTP/SSE MCP transport** | Done | `/mcp/sse` + `/mcp/message`, Bearer auth via `TEAM_API_KEY` |
| **README/docs rebrand** | Done | "Developer Intelligence MCP" positioning |
| **Version 2.0.0** | Done | Across all files |
| Webhook-triggered indexing | Not started | Pillar 1 (event-driven freshness) |
| Convention scoring | Not started | Pillar 2.1 |
| Weekly drift report | Not started | Pillar 2.2 |
| getConventionReport tool | Not started | Pillar 4 |
| getIndexStatus tool | Not started | Pillar 1.2 |
| Git clone manager | Not started | Pillar 3.2 |
| Caddy reverse proxy | Not started | Pillar 3.3 |
| Smoke test suite | Not started | Phase D |

---

## Open Questions

Decisions to make for post-v2.0 work:

1. **PR-level convention review** — Real-time PR comments vs nightly scoring. Real-time adds webhook complexity and GitHub/GitLab API tokens.
2. ~~**Ollama support**~~ — **Resolved**: Implemented in v2.0.0 via `@ai-sdk/openai-compatible`.
3. **Multi-tenant** — Should one pod serve multiple teams with different codebases? Currently one codebase per deployment.
4. **Chat UI investment** — Is the web chat UI still worth maintaining, or should v2 go MCP-only? The chat UI has auth, conversations, memory — significant maintenance surface.
5. **Langfuse** — Keep as optional dependency, or remove to simplify deployment?

---

## Future Architecture: Graph Layer

> This section documents the vision for a future graph-based intelligence layer. Not planned for v2.x.

### The Insight

Vector search finds similar content. But real codebase intelligence requires understanding **relationships**: which files import which, which functions call which, which tests cover which code, which standards apply to which layers.

### Graph Layer Concept

```
┌──────────────────────────────────────────────┐
│              Tiburcio v3 Vision               │
│                                               │
│  ┌─────────┐     ┌──────────┐                │
│  │ Qdrant  │────►│  Graph   │                │
│  │ Vectors │     │  Layer   │                │
│  └─────────┘     └──────────┘                │
│       │               │                       │
│  Semantic         Structural                  │
│  similarity       relationships               │
│  "find similar"   "find connected"            │
│                                               │
│  Combined: "find code similar to X            │
│   that imports from Y and is tested by Z"     │
└──────────────────────────────────────────────┘
```

### What the Graph Would Store

| Node Type | Attributes | Source |
|-----------|-----------|--------|
| File | path, language, repo, lastModified | AST chunker |
| Symbol | name, type (class/method/function), visibility | AST chunker |
| Standard | name, category, content hash | standards/ docs |
| Test | path, framework, targets | test file analysis |
| Review | severity, category, date | nightly pipeline |

| Edge Type | From → To | Source |
|-----------|----------|--------|
| `IMPORTS` | File → File | AST import analysis |
| `DEFINES` | File → Symbol | AST parsing |
| `CALLS` | Symbol → Symbol | AST call graph |
| `TESTED_BY` | Symbol → Test | Test target analysis |
| `VIOLATES` | Review → Standard | Nightly review |
| `APPLIES_TO` | Standard → layer/language | Standard metadata |

### Queries the Graph Enables

- "What code calls this function and what tests cover it?" — `CALLS` + `TESTED_BY` traversal
- "Which standards apply to this file?" — `APPLIES_TO` filtered by layer/language
- "Show me all untested code that changed this week" — date-filtered reviews without `TESTED_BY` edges
- "Which files would break if I change this interface?" — reverse `IMPORTS` + `CALLS` traversal

### Technology Options

| Option | Pros | Cons |
|--------|------|------|
| **Neo4j** | Full graph DB, Cypher queries, mature | Another container, significant complexity |
| **Qdrant payload + Redis** | No new infra, store edges as metadata | Limited traversal, no real graph queries |
| **SQLite with recursive CTEs** | Embedded, zero infra, good enough for small graphs | Not a real graph DB, won't scale |
| **TypeScript in-memory graph** | Zero infra, fast, simple | Lost on restart, memory-bound |

**Recommendation**: Start with Qdrant payload metadata (edges stored as arrays of connected IDs) + Redis for frequently-traversed paths. Migrate to Neo4j only if traversal complexity demands it.

### Status

This is a **vision document**. No implementation is planned for v2.x. The current vector-only approach handles all current use cases. The graph layer becomes valuable when:
- The codebase grows beyond ~2000 files
- "What calls this?" and "What tests this?" become frequent questions
- Convention enforcement needs to understand transitive dependencies

---

## Future Architecture: MCP Client

> This section documents the vision for Tiburcio as an MCP client, not just server. Not planned for v2.x.

### The Insight

Currently Tiburcio is a passive MCP server — Claude Code calls its tools. But Tiburcio could also be an MCP **client**, consuming tools from other MCP servers to enhance its intelligence.

### Use Cases

#### 1. GitHub MCP Server Integration

Tiburcio connects to GitHub's MCP server to:
- Fetch PR details and review comments
- Read issue descriptions for context
- Access branch protection rules for convention enforcement

```
Claude Code ──MCP──► Tiburcio (server)
                         │
                         ├──MCP──► GitHub MCP Server
                         ├──MCP──► Linear MCP Server
                         └──MCP──► Custom internal MCP servers
```

#### 2. Cross-Team Intelligence

Multiple Tiburcio instances share intelligence:
- Team A's Tiburcio consumes Team B's `searchSchemas` to understand shared database tables
- Team B's Tiburcio consumes Team A's `searchStandards` to align conventions

#### 3. IDE Context

Tiburcio consumes an IDE MCP server to understand:
- Which file the developer has open (focus context)
- Recent edit history (active work context)
- Breakpoints and debug state (problem context)

### Architecture

```
┌─────────────────────────────────────────┐
│         Tiburcio as MCP Hub             │
│                                         │
│  MCP Server (9 tools)                   │
│     ▲                                   │
│     │ Claude Code connects here         │
│     │                                   │
│  MCP Client (consumes other servers)    │
│     │                                   │
│     ├──► GitHub (PRs, issues, reviews)  │
│     ├──► Linear (tickets, sprints)      │
│     ├──► Other Tiburcio instances       │
│     └──► IDE context servers            │
└─────────────────────────────────────────┘
```

### Mastra Support

Mastra already supports MCP client connections via `MCPConfiguration`:

```typescript
import { MCPConfiguration } from "@mastra/mcp";

const mcpConfig = new MCPConfiguration({
  servers: {
    github: {
      url: new URL("https://github-mcp.internal/sse"),
      transport: "sse",
    },
  },
});

// Tools from connected servers available to Tiburcio's agents
const tools = await mcpConfig.getTools();
```

### Status

This is a **vision document**. No implementation is planned for v2.x. The MCP client capability becomes valuable when:
- The team uses multiple MCP servers that could share context
- PR-level convention review requires GitHub API access
- Cross-team intelligence sharing is needed
