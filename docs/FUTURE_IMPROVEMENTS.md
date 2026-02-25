# Tiburcio Roadmap — The Best Onboarding Knowledge System

## Mission

Tiburcio exists to answer one question: **"How do we do things here?"**

Every new developer who joins the team should be able to ask Tiburcio about conventions, architecture, recent changes, code patterns, and database schemas — and get answers grounded in the actual codebase, not hallucinations.

The roadmap below focuses exclusively on making Tiburcio the most useful onboarding tool possible. No scope creep into code editing, refactoring, or generic AI assistant territory. Every feature should make a new team member productive faster.

---

## Completed

| Version | What was delivered |
|---------|-------------------|
| v1.0.0 | Nightly re-indexing, code review agent, test suggestion engine, 7 RAG tools, MCP server |
| v1.1.0 | AST-based chunking (tree-sitter), contextual retrieval, query expansion, hybrid search (BM25 + vector RRF), parent-child chunk expansion |

---

## Phase 4: Onboarding Intelligence

**Status: Next**

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

## Phase 6: Remote Codebase Support

**Status: Planned**

**Problem**: Tiburcio currently requires the codebase to be on the same machine (`CODEBASE_REPOS` paths are local filesystem paths). This works when running on a developer's laptop or a VPS with volume mounts, but limits deployment flexibility.

### 6.1 Git Clone into Container

Instead of requiring a mounted path, Tiburcio clones the repo itself:
- New env vars: `CODEBASE_REPO_URL`, `CODEBASE_GIT_TOKEN`
- On startup: `git clone` into a known directory
- Before each nightly run: `git pull` to get latest changes
- All existing indexers work unchanged

### 6.2 Remote MCP Server (HTTP/SSE Transport)

Switch MCP to HTTP/SSE transport for network access. Claude Code on a developer's laptop connects to Tiburcio over the network. Requires auth on the MCP endpoint.

---

## Phase 7: Error Tracking

**Status: Planned**

**Recommendation**: [Bugsink](https://www.bugsink.com/) — single-container, self-hosted, Sentry SDK compatible, <1 GB RAM. Fits Tiburcio's "runs locally" philosophy.

- `docker-compose.yml`: Add `bugsink` service
- Backend: `@sentry/node` SDK with `initBugsink()` in `config/`
- Frontend: `@sentry/vue` SDK with privacy defaults
- Captures: unhandled exceptions, BullMQ job failures, nightly pipeline errors

---

## Priority Matrix

| Phase | Impact | Effort | Priority |
|-------|--------|--------|----------|
| 4 — Onboarding Intelligence | Very high | Medium-High | **Next** |
| 5 — Convention Guardian | High | Medium | Later |
| 6 — Remote Codebase | High | Medium | Later (independent) |
| 7 — Error Tracking | Medium | Low | Later (independent) |

---

## What This Is NOT

Tiburcio is **not** trying to be:
- A code editing agent (Claude Code already does that)
- A CI/CD pipeline (GitHub Actions already does that)
- A generic AI chatbot (ChatGPT already does that)
- A project management tool (Jira already does that)

Tiburcio is a **codebase knowledge system** that gets smarter every night and makes every new developer productive faster. That's the focus. That's the mission.
