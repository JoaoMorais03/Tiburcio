# Tiburcio Roadmap — The Best Onboarding Knowledge System

## Mission

Tiburcio exists to answer one question: **"How do we do things here?"**

Every new developer who joins the team should be able to ask Tiburcio about conventions, architecture, recent changes, code patterns, and database schemas — and get answers grounded in the actual codebase, not hallucinations.

The roadmap below focuses exclusively on making Tiburcio the most useful onboarding tool possible. No scope creep into code editing, refactoring, or generic AI assistant territory. Every feature should make a new team member productive faster.

---

## Phase 1: Knowledge Freshness — Nightly Re-Indexing (Done in v1.0.0)

**Status: Complete**

- BullMQ repeatable cron jobs run nightly at 2 AM
- Incremental indexing via `git diff` against last indexed commit SHA (stored in Redis)
- Stale vector cleanup — deletes vectors for removed/renamed files before re-upserting
- All 4 indexing jobs: `index-standards`, `index-codebase`, `index-architecture`, `nightly-review`

---

## Phase 2: Nightly Code Review Agent (Done in v1.0.0)

**Status: Complete**

- `code-review-agent` reviews merges to develop against team standards
- `git-diff.ts` reads merge commits and file diffs via `execFile`
- Review insights stored in Qdrant `reviews` collection (1024-dim, cosine)
- `searchReviews` tool exposed to chat agent and MCP server
- Integrated into the nightly-review Mastra workflow (multi-step)

---

## Phase 3: Test Suggestion Engine (Done in v1.0.0)

**Status: Complete**

- Nightly pipeline generates test scaffolds from reviewed diffs
- Suggestions stored in Qdrant `test-suggestions` collection
- `getTestSuggestions` tool exposed to chat agent and MCP server
- Suggestions are searchable knowledge, never auto-committed — surfaced as recommendations

---

## Phase 4: Onboarding Intelligence

**Status: Planned**

**Problem**: Every new developer asks the same questions in a different order. There's no structured path from "I just joined" to "I'm productive."

**Goal**: Tiburcio proactively guides onboarding with learning paths, knowledge gap detection, and "catch-up" summaries.

### 4.1 Learning Path Generator

A new tool that creates a personalized onboarding path:

```
Input: { role: "backend", team: "payments", experience: "mid" }
Output: Ordered list of topics with links to relevant standards, architecture docs, and code examples
```

How it works:
1. Query `architecture` collection to build a component dependency graph
2. Query `standards` to find conventions relevant to the role
3. Query `code-chunks` to find the most referenced/imported files in the target area
4. Order topics from foundational (DB schema, auth flow) to specific (payment service, batch jobs)

### 4.2 Knowledge Gap Detection

Nightly job that compares:
- Files in the codebase (from `code-chunks` collection) vs files documented in `standards`
- Areas with high code churn (many recent commits) vs areas with review coverage
- Modules with tests vs modules without

Output: A `knowledge-gaps` Qdrant collection that the agent uses to say "the notification module has no documentation — you might want to talk to the team lead about how it works."

### 4.3 "What Did I Miss?" Summary Tool

```typescript
export const getChangeSummary = createTool({
  id: "getChangeSummary",
  description:
    "Generate a summary of what changed in the codebase over a time period. " +
    "Perfect for developers returning from vacation or switching projects.",
  inputSchema: z.object({
    since: z.string().describe("How far back to summarize, e.g. '7d', '2w', '2025-01-01'"),
    area: z.string().optional().describe("Focus area, e.g. 'auth', 'payments', 'frontend'"),
  }),
});
```

This queries the `reviews` collection, groups by area and severity, and produces a human-readable summary.

### 4.4 Agent Enhancement

Enhance the chat agent's system prompt to:
- Detect when a user seems new (first conversation, basic questions) and suggest a learning path
- Track which topics the user has explored via working memory
- Proactively suggest "you might also want to know about X" based on what they've asked about
- Use `searchReviews` when the question touches something that changed recently

---

## Phase 5: Convention Guardian

**Status: Planned**

**Problem**: Standards docs exist but nobody checks if new code follows them. Convention drift is invisible until it's a big problem.

**Goal**: Tiburcio actively monitors for convention violations and surfaces them before they spread.

### 5.1 Convention Scoring in Nightly Review

Enhance the code review agent to produce a **convention adherence score** per merge:
- Compare each changed file against relevant standards
- Score: 0-100% adherence
- Track scores over time in a `convention-scores` collection
- Surface trends: "Convention adherence for the payments module dropped from 92% to 74% this month"

### 5.2 PR Integration (Optional)

If the team wants real-time feedback (not just nightly):
- GitHub webhook listener that triggers the review agent on PR creation
- Posts review comments directly on the PR via GitHub API
- Scoped to convention violations only (not subjective code style)

### 5.3 Standards Drift Report

Weekly job that:
1. Queries all `reviews` from the past week with `category: "convention"`
2. Groups by standard violated
3. Produces a report: "This week's top convention violations: 1. Missing Zod validation (5 occurrences), 2. Raw SQL instead of Drizzle (3 occurrences)"
4. Stores the report in Qdrant so the onboarding agent can reference it

---

## Qdrant Collections (Current + Planned)

| Collection | Status | Purpose |
|-----------|--------|---------|
| `standards` | Live | Team conventions, best practices |
| `code-chunks` | Live | Indexed source code |
| `architecture` | Live | Architecture documentation |
| `schemas` | Live | Database schema docs |
| `reviews` | Live | Nightly code review insights |
| `test-suggestions` | Live | AI-generated test scaffolds |
| `knowledge-gaps` | **Phase 4** | Under-documented areas |
| `convention-scores` | **Phase 5** | Convention adherence tracking |

---

## New Tools Summary

| Tool | Status | Added To | Purpose |
|------|--------|----------|---------|
| `searchReviews` | Live | Chat agent + MCP | Query nightly review insights |
| `getTestSuggestions` | Live | Chat agent + MCP | Test scaffolds from recent merges |
| `getChangeSummary` | Phase 4 | Chat agent + MCP | "What did I miss?" summaries |
| `getLearningPath` | Phase 4 | Chat agent + MCP | Personalized onboarding paths |

---

## Phase 6: Remote Codebase Support

**Status: Planned**

**Problem**: Tiburcio currently requires the codebase to be on the same machine (`CODEBASE_PATH` is a local filesystem path). This works when running on a developer's laptop, but limits deployment flexibility — you can't run Tiburcio on a server and point it at a repo that lives elsewhere.

**Goal**: Support indexing codebases that aren't on the local filesystem.

### 6.1 Git Clone into Container (Primary Approach)

Instead of requiring a mounted path, Tiburcio clones the repo itself:

- New env vars: `CODEBASE_REPO_URL` (e.g., `https://github.com/org/repo.git`), `CODEBASE_GIT_TOKEN` (GitHub PAT or deploy key)
- On startup: `git clone` into a known directory (e.g., `/data/codebase`)
- Before each nightly run: `git pull` to get latest changes
- All existing indexers work unchanged — they already read from a filesystem path
- All existing git-diff logic works unchanged — it already runs git commands against a local repo
- Just needs a thin "sync" step that runs before indexing

**Fallback behavior**: If `CODEBASE_PATH` is set, use it directly (current behavior). If `CODEBASE_REPO_URL` is set instead, clone and use the clone directory.

### 6.2 Remote MCP Server (HTTP/SSE Transport)

Currently the MCP server uses stdio transport (local only). For remote access:

- Switch to HTTP/SSE transport (Mastra already supports this)
- Claude Code on a developer's laptop connects to Tiburcio over the network
- Requires auth on the MCP endpoint (JWT or shared secret)
- Enables a centralized Tiburcio instance that the whole team shares

### 6.3 Lightweight Agent CLI (Future)

For maximum flexibility, a CLI tool that runs in any repo and pushes data to Tiburcio:

- Small binary/script that runs `git diff`, chunks files locally, sends results to Tiburcio's API
- Tiburcio becomes a pure server that receives pre-processed data
- Works in CI/CD pipelines, developer laptops, or any environment with git access
- More complex to build but enables use cases where git clone isn't practical (monorepos, restricted access)

**Files to change**: `indexer/index-codebase.ts` (add clone/pull logic), `config/env.ts` (new env vars), `jobs/queue.ts` (sync step before index), `mcp.ts` (HTTP transport option)

---

## Phase 7: Error Tracking

**Status: Planned**

**Problem**: No structured error tracking. If something fails at 3 AM during a nightly run, you only know from Docker logs — no aggregation, no alerting, no deduplication.

**Recommendation**: [Bugsink](https://www.bugsink.com/) — single-container, self-hosted, Sentry SDK compatible, <1 GB RAM. Fits Tiburcio's "runs locally" philosophy. Sentry self-hosted was evaluated and rejected (25+ containers, 32 GB RAM minimum).

### Implementation

- `docker-compose.yml`: Add `bugsink` service (single container)
- Backend: `@sentry/node` SDK (Bugsink is wire-compatible) with `initBugsink()` in `config/`
- Frontend: `@sentry/vue` SDK with `maskAllText: true`, `blockAllMedia: true` (privacy defaults)
- Captures: unhandled exceptions, BullMQ job failures, nightly pipeline errors
- No new external dependencies — runs entirely within the Docker Compose stack

**Files to change**: `docker-compose.yml`, new `config/bugsink.ts`, `server.ts` (init + error middleware), `jobs/queue.ts` (job failure capture)

---

## Implementation Order and Dependencies

```
Phase 1 ──────────────> Phase 2 ──────────────> Phase 3
(Nightly indexing)      (Review agent)           (Test suggestions)
  ✅ DONE                 ✅ DONE                   ✅ DONE
                               │
                               ▼
                          Phase 4 ──────────────> Phase 5
                          (Onboarding intel)       (Convention guardian)
                            NEXT                     LATER

                          Phase 6               Phase 7
                          (Remote codebase)     (Error tracking)
                            LATER (independent)   LATER (independent)
```

### Priority Matrix

| Phase | Impact on Onboarding | Effort | Priority |
|-------|---------------------|--------|----------|
| 1 — Nightly Re-Index | High (fresh knowledge) | Low | **Done** |
| 2 — Review Agent | Very high (recent change awareness) | Medium | **Done** |
| 3 — Test Suggestions | Medium (helps testing questions) | Medium | **Done** |
| 4 — Onboarding Intelligence | Very high (guided paths) | Medium-High | **Next** |
| 5 — Convention Guardian | High (prevents drift) | Medium | Later |
| 6 — Remote Codebase | High (deployment flexibility) | Medium | Later (independent) |
| 7 — Error Tracking | Medium (ops reliability) | Low | Later (independent) |

---

## What This Is NOT

Tiburcio is **not** trying to be:
- A code editing agent (Claude Code already does that)
- A CI/CD pipeline (GitHub Actions already does that)
- A generic AI chatbot (ChatGPT already does that)
- A project management tool (Jira already does that)

Tiburcio is a **codebase knowledge system** that gets smarter every night and makes every new developer productive faster. That's the focus. That's the mission.
