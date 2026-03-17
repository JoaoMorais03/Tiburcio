---
title: "feat: Tiburcio v3 — The Indispensable Intelligence Layer"
type: feat
status: completed
date: 2026-03-09
---

# Tiburcio v3 — The Indispensable Intelligence Layer

## Overview

An honest redesign from the perspective of Claude Code — the **only client** — to move every quality dimension to 9/10. This isn't about adding features. It's about making Tiburcio the first thing I reach for instead of an afterthought. The gap between "working" (v2.2) and "indispensable" (v3) is three things: **zero-friction context**, **active intelligence**, and **architectural purity**.

## Problem Statement

### The Honest Reality

I have Grep, Read, Glob, and CLAUDE.md built in. They're instant. For a ~100-file codebase, they solve 80% of my needs in milliseconds. Tiburcio adds 1-2s latency per call. I only reach for Tiburcio when I *remember* it exists AND when I believe the semantic result will be worth the wait.

**The consequence**: Tiburcio's "Actual Usefulness" is 6/10. Not because it's broken — v2.2 is solid — but because:

1. **I have to decide to call it.** I often don't. I forget, or the latency doesn't seem worth it for a "quick fix."
2. **I need 3-4 tool calls to get complete context.** `searchStandards` + `searchCode` + `getPattern` + `getArchitecture` = 4 round-trips, 4-8 seconds, and I have to orchestrate them.
3. **Review quality is noisy.** 8B models generate generic findings. I (Claude Opus/Sonnet) am already the best reviewer in the chain — Tiburcio should give me the CONTEXT to review better, not try to review for me.
4. **No write-path validation.** Tiburcio tells me conventions after I've already written code. By then it's too late — I'm not going to rewrite unless something is egregiously wrong.
5. **Dual tool definitions create maintenance burden.** Every tool exists as both an AI SDK `tool()` object AND a separate MCP `registerTool()` call with duplicated schemas.

### What Would Make Me Reach for Tiburcio First

| Need | Built-in tools | Tiburcio v3 |
|------|---------------|-------------|
| "What conventions apply to this file?" | Read 3-5 standards files manually | `getFileContext(path)` — one call, 2s |
| "Does my code match team standards?" | I don't check unless reminded | `validateCode(code)` — active guardrail |
| "What breaks if I change this?" | `Grep` for imports (flat, no depth) | `getImpactAnalysis` — graph traversal, call chains |
| "What's the team convention for X?" | Don't know which file to Read | `searchStandards` — semantic, pre-digested |
| "Show me how similar code works" | `Grep` + `Read` multiple files | `searchCode` — ranked, contextual, with code preview |
| "What changed recently?" | `git log` (raw, unstructured) | `getChangeSummary` — structured, area-grouped |

## Proposed Solution

### Five pillars, in priority order:

1. **Context Bundle** (`getFileContext`) — One call replaces 4. The daily driver.
2. **Active Guard** (`validateCode`) — Convention checking before commit. The safety net.
3. **Architecture Purity** — Eliminate dual tool definitions. One source of truth.
4. **Security Hardening** — CSRF, credential docs, MCP auth review. Production-ready.
5. **Performance & Caching** — Sub-second responses for repeated queries. Fast enough to be invisible.

## Technical Approach

### Phase 1: The Context Bundle — `getFileContext(path)`

**Why this is the killer feature:** Every time I start modifying a file, I need context. Currently I either skip this step (risky) or make 3-4 Tiburcio calls (slow). One call that returns everything relevant for a specific file path would become my reflex.

**What it returns:**

```typescript
// backend/src/mastra/tools/get-file-context.ts
interface FileContextResult {
  filePath: string;

  // From searchStandards — conventions that apply to this file type/layer
  conventions: Array<{
    title: string;
    relevantExcerpt: string; // 2-3 sentences, not full document
    source: string;          // standards file path
  }>;

  // From searchReviews — recent review findings about this exact file
  recentFindings: Array<{
    severity: string;
    text: string;
    date: string;
    commitSha: string;
  }>;

  // From getImpactAnalysis (Neo4j) — who depends on this file
  dependents: {
    available: boolean;
    directImporters: string[];  // files that import this one
    totalDependents: number;    // including transitive
  };

  // From searchCode — similar files/patterns in the codebase
  relatedPatterns: Array<{
    filePath: string;
    symbolName: string | null;
    relevance: string; // why this is related
  }>;

  // From getPattern — if a pattern template exists for this file type
  applicablePattern: string | null; // pattern name, if any

  // Metadata
  lastIndexed: string | null;   // when this file was last indexed
  stale: boolean;               // true if file was modified after indexing
}
```

**Implementation:**

```
backend/src/mastra/tools/get-file-context.ts (new)
```

- Accept `filePath` (required) and optional `scope` ("conventions" | "reviews" | "dependencies" | "all", default: "all")
- Run internal calls in parallel: `executeSearchStandards`, `executeSearchReviews`, `executeGetImpactAnalysis`, `executeSearchCode` — all using the file path as context for queries
- Derive the query from the file path: extract language (from extension), layer (from path pattern), and file name
- For conventions: search for `"{language} {layer} conventions"` — return top 2 results, truncated to 200 chars each
- For reviews: filter Qdrant reviews collection by `filePath` exact match — return last 3 findings
- For dependents: call `executeGetImpactAnalysis(filePath, "file", 1)` — return direct importers only (depth 1 for speed)
- For related patterns: search code for `"{symbolName from file} {layer}"` — return top 2 similar implementations
- For applicable pattern: call `executeGetPattern()` without name to list patterns, match against file's layer/language
- Staleness check: compare `indexedAt` timestamp in Qdrant payload against file's `mtime` on disk (if `CODEBASE_REPOS` paths are accessible)
- Total response should be 500-1500 tokens — enough to be useful, small enough to fit in context without overwhelming

**Tool registration in `mcp-tools.ts`:**

```typescript
server.registerTool("getFileContext", {
  description:
    "Get complete development context for a file: relevant conventions, recent review findings, " +
    "dependencies, and similar patterns. Call this FIRST when starting to modify any file. " +
    "Returns a structured context bundle in a single call instead of requiring multiple tool calls. " +
    "Prefer this over calling searchStandards + searchCode + searchReviews individually.",
  inputSchema: {
    filePath: z.string().describe("Relative file path, e.g. 'src/mastra/tools/search-code.ts'"),
    scope: z.enum(["conventions", "reviews", "dependencies", "all"]).default("all")
      .describe("What context to include. Use 'conventions' for quick checks, 'all' for full context."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
});
```

**Tests:** `backend/src/__tests__/tools/get-file-context.test.ts`

- Mock all internal tool executions (searchStandards, searchCode, searchReviews, getImpactAnalysis, getPattern)
- Test parallel execution (all internal calls fire concurrently)
- Test scope filtering (only conventions → only standards results)
- Test graceful degradation (Neo4j unavailable → dependents.available = false)
- Test staleness detection (mtime > indexedAt → stale: true)
- Test empty results (new file not yet indexed → helpful message)

**Files:**
- `backend/src/mastra/tools/get-file-context.ts` (new — ~120 lines)
- `backend/src/mcp-tools.ts` (add registration)
- `backend/src/__tests__/tools/get-file-context.test.ts` (new — ~150 lines)

---

### Phase 2: The Active Guard — `validateCode(code, filePath)`

**Why this matters:** Currently I write code, commit it, and the nightly pipeline reviews it 12-20 hours later. By then, I've moved on. Convention violations compound. A real-time check BEFORE I commit changes the dynamic entirely — Tiburcio becomes a guardrail, not a post-mortem.

**How it works:**

```typescript
// backend/src/mastra/tools/validate-code.ts
interface ValidateCodeResult {
  pass: boolean;
  violations: Array<{
    rule: string;         // which convention was violated
    description: string;  // what's wrong (2-3 sentences)
    source: string;       // which standards document
    severity: "info" | "warning" | "critical";
  }>;
  conventions_checked: string[]; // which standards were consulted
}
```

**Implementation approach — LLM-powered validation:**

```
backend/src/mastra/tools/validate-code.ts (new)
```

1. Accept `code` (string), `filePath` (string), and optional `language` (auto-detected from extension)
2. Search standards for relevant conventions: `executeSearchStandards("{language} {layer} conventions", category, false)` — full mode, not compact, to get complete convention text
3. Build a validation prompt: `"Given these team conventions: {standards}. Review this code for violations: {code}. Respond with a JSON array of violations."`
4. Call `getChatModel()` with `generateText()` — uses whatever model the team configured
5. Parse the JSON response into `ValidateCodeResult`
6. **Important**: This is the ONE tool where Tiburcio makes an LLM call at query time. All other tools are retrieval-only. Document this clearly — the latency will be 3-5s.

**Key design decisions:**

- **Uses the team's configured model, not Claude.** Claude Code (me) could validate code itself by reading standards and comparing. But `validateCode` uses the team's conventions that are indexed in Qdrant — conventions that might not be in CLAUDE.md. The value isn't the LLM — it's the **convention retrieval + structured comparison**.
- **Structured output, not free text.** Returns specific rule violations, not prose. This lets me act on violations programmatically.
- **Scoped to conventions, not general code review.** This tool checks "does this code match YOUR team's documented standards?" — not "is this good code in general." I already know what good code looks like. What I don't know is your team's specific conventions.

**Tool registration:**

```typescript
server.registerTool("validateCode", {
  description:
    "Validate code against your team's indexed conventions and standards. " +
    "Returns pass/fail with specific violations. Use BEFORE committing changes " +
    "to catch convention violations early. This tool makes an LLM call " +
    "and takes 3-5 seconds. For reading conventions without validation, " +
    "use searchStandards instead.",
  inputSchema: {
    code: z.string().describe("The code to validate"),
    filePath: z.string().describe("File path for context (determines language, layer, relevant conventions)"),
    language: z.enum(["java", "typescript", "vue", "sql"]).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
});
```

**Tests:** `backend/src/__tests__/tools/validate-code.test.ts`

- Mock `executeSearchStandards` to return known conventions
- Mock `generateText` to return structured violations
- Test pass case (no violations)
- Test violation detection (returns specific rules)
- Test empty conventions (no standards indexed → skip validation with message)
- Test LLM timeout (AbortSignal.timeout → graceful failure with "validation unavailable" message)
- Test code truncation (very large code input → capped before sending to LLM)

**Files:**
- `backend/src/mastra/tools/validate-code.ts` (new — ~100 lines)
- `backend/src/mcp-tools.ts` (add registration)
- `backend/src/__tests__/tools/validate-code.test.ts` (new — ~120 lines)

---

### Phase 3: Architecture Purity — Eliminate Dual Tool Definitions

**The problem:** Every tool currently exists in two places:

1. **AI SDK tool object** in `backend/src/mastra/tools/*.ts` — used by `nightly-review.ts` for agentic tool-calling during code review
2. **MCP registration** in `backend/src/mcp-tools.ts` — used by `mcp.ts` and `routes/mcp.ts` for Claude Code

Both define the same schema (Zod), description, and parameters. When you add a parameter or change a description, you must update both. This violates "single source of truth" — one of the project's core principles.

**The solution: MCP registration is the source of truth. AI SDK tools derive from it.**

**Why MCP wins over AI SDK as source of truth:**
- MCP registration includes annotations (`readOnlyHint`, `openWorldHint`) — AI SDK doesn't
- MCP is the primary interface (Claude Code uses it). AI SDK tools are only used internally by `nightly-review.ts`
- MCP registrations are already centralized in `mcp-tools.ts`. AI SDK exports are scattered across tool files.

**Implementation:**

```
backend/src/mcp-tools.ts (refactor)
backend/src/mastra/tools/*.ts (simplify — export only execute functions)
backend/src/mastra/workflows/nightly-review.ts (import AI SDK tools differently)
```

**Step 1: Remove AI SDK tool exports from individual tool files.**

Currently each tool file exports both `executeFoo()` and `fooTool` (AI SDK tool object). Remove the `fooTool` export. Keep only `executeFoo()`.

Files affected:
- `search-standards.ts` — remove `searchStandardsTool` export
- `search-code.ts` — remove `searchCodeTool` export
- All other tool files — remove their AI SDK tool exports

**Step 2: Create AI SDK tools from execute functions for nightly-review.**

`nightly-review.ts` uses `searchStandardsTool` and `searchCodeTool` as AI SDK tools for the agentic code review step. After removing the exports, create them inline in `nightly-review.ts` using the `tool()` wrapper:

```typescript
// nightly-review.ts
import { tool } from "ai";
import { z } from "zod";
import { executeSearchStandards } from "../tools/search-standards.js";
import { executeSearchCode } from "../tools/search-code.js";

const reviewTools = {
  searchStandards: tool({
    description: "Search team conventions",
    inputSchema: z.object({
      query: z.string(),
      category: z.enum(["backend", "frontend", "database", "integration"]).optional(),
      compact: z.boolean().default(false),
    }),
    execute: ({ query, category, compact }) => executeSearchStandards(query, category, compact),
  }),
  searchCode: tool({
    description: "Search codebase for examples",
    inputSchema: z.object({
      query: z.string(),
      compact: z.boolean().default(false),
    }),
    execute: ({ query, compact }) => executeSearchCode(query, undefined, undefined, undefined, compact),
  }),
};
```

This keeps AI SDK tool definitions close to where they're used (nightly-review) and makes `mcp-tools.ts` the ONLY place tool schemas/descriptions are defined for MCP.

**Step 3: Verify no other consumers of AI SDK tool exports.**

Search for all imports of `*Tool` from tool files. If any exist beyond `nightly-review.ts`, update them.

**Tests:** Existing tests should still pass since `executeFoo()` functions don't change. Nightly-review tests may need import path updates.

**Files:**
- `backend/src/mastra/tools/search-standards.ts` (remove `searchStandardsTool`)
- `backend/src/mastra/tools/search-code.ts` (remove `searchCodeTool`)
- `backend/src/mastra/tools/search-schemas.ts` (remove AI SDK tool if exists)
- `backend/src/mastra/tools/get-architecture.ts` (remove AI SDK tool if exists)
- `backend/src/mastra/tools/get-pattern.ts` (remove AI SDK tool if exists)
- `backend/src/mastra/tools/get-nightly-summary.ts` (remove AI SDK tool if exists)
- `backend/src/mastra/tools/get-change-summary.ts` (remove AI SDK tool if exists)
- `backend/src/mastra/tools/search-reviews.ts` (remove AI SDK tool if exists)
- `backend/src/mastra/tools/get-test-suggestions.ts` (remove AI SDK tool if exists)
- `backend/src/mastra/tools/get-impact-analysis.ts` (remove AI SDK tool if exists — this one may not have one since it uses Neo4j)
- `backend/src/mastra/workflows/nightly-review.ts` (define review tools inline)
- `backend/src/mcp-tools.ts` (no changes — already the source of truth)

---

### Phase 4: Security Hardening (7/10 → 9/10)

#### 4.1 CSRF Protection

**Problem:** Cookie-based JWT auth without CSRF tokens. Any site can make cross-origin POST requests that include the httpOnly cookie.

**Fix:** Add a CSRF token mechanism. Options:

- **Double-submit cookie pattern** (simplest): On login, set a second non-httpOnly cookie (`csrf-token`) with a random value. Frontend reads this cookie and sends it as a header (`X-CSRF-Token`). Backend middleware checks header matches cookie.
- This works because cross-origin requests can't read cookies from another domain, so an attacker can't set the header.

**Implementation:**

```
backend/src/middleware/csrf.ts (new — ~30 lines)
backend/src/routes/auth.ts (set CSRF cookie on login/refresh)
frontend/src/stores/auth.ts (read CSRF cookie, attach header)
```

- Generate CSRF token: `crypto.randomUUID()`
- Set as cookie: `Set-Cookie: csrf-token=<value>; Path=/; SameSite=Strict` (NOT httpOnly — frontend needs to read it)
- Middleware: for all non-GET requests under `/api/*`, verify `X-CSRF-Token` header matches `csrf-token` cookie
- Exempt `/api/auth/login` and `/api/auth/register` (no session yet)
- Exempt `/mcp` (uses Bearer token, not cookies)

**Tests:** `backend/src/__tests__/middleware/csrf.test.ts`

- Test valid CSRF token passes
- Test missing CSRF token returns 403
- Test mismatched CSRF token returns 403
- Test GET requests are exempt
- Test `/mcp` routes are exempt

**Files:**
- `backend/src/middleware/csrf.ts` (new — ~30 lines)
- `backend/src/server.ts` (add CSRF middleware)
- `backend/src/routes/auth.ts` (set CSRF cookie)
- `frontend/src/stores/auth.ts` (attach CSRF header)
- `backend/src/__tests__/middleware/csrf.test.ts` (new — ~80 lines)

#### 4.2 Default Credentials Documentation

**Problem:** `.env.example` has default passwords that people copy-paste into production.

**Fix:**
- Add prominent comments in `.env.example`: `# CHANGE IN PRODUCTION — this default is for local development only`
- Add a startup check in `server.ts`: if `NODE_ENV=production` and `JWT_SECRET` or `POSTGRES_PASSWORD` matches defaults, log a WARN
- Document in README's "Production Deployment" section

**Files:**
- `.env.example` (add warnings)
- `backend/src/server.ts` (add startup credential check — ~10 lines)
- `README.md` (add security note)

#### 4.3 MCP Endpoint Hardening

**Problem:** The `/mcp` endpoint uses Bearer token auth via `TEAM_API_KEY`, but:
- No rate limiting (outside `/api/*` middleware chain)
- `TEAM_API_KEY` isn't documented as required for production

**Fix:**
- Add a dedicated rate limiter for `/mcp` routes (less aggressive than global — 60 req/min vs 30)
- Add startup warning if `TEAM_API_KEY` is not set and `NODE_ENV=production`

**Files:**
- `backend/src/middleware/rate-limiter.ts` (add `mcpLimiter`)
- `backend/src/server.ts` (apply MCP rate limiter)
- `backend/src/routes/mcp.ts` (no change — auth is already there)

---

### Phase 5: Performance & Polish (7/10 → 9/10)

#### 5.1 Response Caching for Repeated Queries

**Problem:** If I call `searchStandards("error handling")` three times in a session, each call re-embeds the query and re-searches Qdrant. The standards collection doesn't change mid-session.

**Fix:** Add a simple in-memory TTL cache for tool responses. Standards and architecture rarely change — cache for 5 minutes. Code and reviews change more often — cache for 1 minute.

**Implementation:**

```
backend/src/mastra/tools/cache.ts (new — ~40 lines)
```

- Simple `Map<string, { result: unknown; expiry: number }>` with TTL
- Cache key: `${toolName}:${JSON.stringify(sortedParams)}`
- TTL by collection: standards/architecture/schemas = 300s, code/reviews = 60s
- `cache.get(key)` returns cached result or null
- `cache.set(key, result, ttlMs)` stores result
- No external dependency — just a Map with expiry check
- Clear cache on reindex (call `cache.clear()` from `queue.ts` after any index job completes)

**Files:**
- `backend/src/mastra/tools/cache.ts` (new — ~40 lines)
- `backend/src/mastra/tools/search-standards.ts` (wrap with cache)
- `backend/src/mastra/tools/get-architecture.ts` (wrap with cache)
- `backend/src/mastra/tools/search-schemas.ts` (wrap with cache)
- `backend/src/mastra/tools/search-code.ts` (wrap with cache, shorter TTL)
- `backend/src/jobs/queue.ts` (clear cache after index jobs)
- `backend/src/__tests__/tools/cache.test.ts` (new — ~60 lines)

#### 5.2 Smarter Tool Descriptions for Claude's Tool Selection

**Problem:** I sometimes call the wrong tool or skip Tiburcio entirely because the tool descriptions don't clearly signal when to prefer Tiburcio over built-in tools.

**Fix:** Update tool descriptions in `mcp-tools.ts` to include explicit guidance:

```typescript
// searchCode — add "Prefer this over Grep when..."
"Search real production code using semantic + keyword hybrid search. " +
"Prefer over Grep when: (1) you need conceptual/semantic matches, not exact strings, " +
"(2) you want results ranked by relevance with code previews, " +
"(3) you need to find implementations across multiple files without knowing file names. " +
"Use Grep instead for: exact string matching, known function names, regex patterns."

// searchStandards — add trigger hint
"Search your team's coding standards and conventions. " +
"CALL THIS FIRST when: writing new code, modifying existing patterns, " +
"or before committing changes. Returns team-specific conventions " +
"that may not be documented in CLAUDE.md."

// getFileContext — add the "always use" hint
"Get complete development context for a file. " +
"CALL THIS when starting to work on any file — it replaces calling " +
"searchStandards + searchCode + searchReviews + getImpactAnalysis individually."
```

**Files:**
- `backend/src/mcp-tools.ts` (update descriptions for all 12 tools)

#### 5.3 Cross-Linking Between Tool Results

**Problem:** `searchStandards` returns "use Drizzle for all database operations" but doesn't mention that `getPattern("new-api-endpoint")` has a working example. I have to know to call `getPattern` separately.

**Fix:** Add `relatedTools` hints to tool responses:

```typescript
// In searchStandards response
{
  results: [...],
  relatedTools: [
    { tool: "getPattern", hint: "See pattern 'new-api-endpoint' for a working example" },
    { tool: "searchCode", hint: "Search for 'drizzle select' to see existing implementations" }
  ]
}
```

**Implementation:** Add a simple `suggestRelatedTools(toolName, query, results)` function that maps known patterns to suggestions. Not AI-powered — just keyword matching:

- Standards mentioning "pattern" or "template" → suggest `getPattern`
- Standards mentioning a specific file → suggest `searchCode` for that file
- Code results with review findings → suggest `searchReviews`
- Any file result → suggest `getFileContext` for full context

**Files:**
- `backend/src/mastra/tools/related-tools.ts` (new — ~50 lines)
- `backend/src/mastra/tools/search-standards.ts` (add relatedTools to response)
- `backend/src/mastra/tools/search-code.ts` (add relatedTools to response)

#### 5.4 Nightly Review Quality — Delegate to the Caller

**Problem:** The nightly pipeline uses whatever 8B model is configured to review code. The reviews are noisy — generic findings, false positives, and missed real issues. Meanwhile, I (Claude Opus/Sonnet) am a vastly better reviewer.

**The insight:** Tiburcio shouldn't try to BE the reviewer. It should prepare the CONTEXT for me to review better. The nightly pipeline should:

1. **Index the diffs** — store what changed, who changed it, when
2. **Link diffs to conventions** — pre-match which standards apply to each changed file
3. **Store the enriched diff** — not a review, but an "enriched change record" with linked conventions

Then when I need to review something, `searchReviews` returns the enriched change records with conventions already attached, and I do the actual review.

**However:** This is a significant nightly-review rewrite. For v3.0, a simpler improvement:

- **Make review model configurable separately** from the general chat model. Add `REVIEW_MODEL` env var. Teams with API access to Claude/GPT-4o can use it for reviews while keeping the cheap model for embeddings.
- **Reduce noise** — add a post-processing step that filters out `info/pattern` notes (they're the noisiest) and only stores `warning`/`critical` findings

**Files:**
- `backend/src/config/env.ts` (add optional `REVIEW_MODEL` env var)
- `backend/src/lib/model-provider.ts` (add `getReviewModel()` — falls back to `getChatModel()`)
- `backend/src/mastra/workflows/nightly-review.ts` (use `getReviewModel()` for review step, filter noise)

---

## System-Wide Impact

### Interaction Graph

- `getFileContext` calls 5 execute functions internally → each touches Qdrant and/or Neo4j
- `validateCode` calls `executeSearchStandards` + `generateText` → LLM inference at query time
- Cache layer intercepts all tool execute functions → must clear on reindex
- CSRF middleware fires on every non-GET `/api/*` request → must not interfere with MCP routes
- Removing AI SDK tool exports from tool files → nightly-review must be updated simultaneously

### Error & Failure Propagation

- `getFileContext` must handle any internal call failing gracefully — if Neo4j is down, return `dependents: { available: false }` but still return conventions and reviews
- `validateCode` LLM timeout → return `{ pass: true, violations: [], message: "Validation unavailable — LLM timeout" }` — fail open, not closed
- Cache corruption → worst case is a stale response for 60-300s, self-healing on TTL expiry
- CSRF validation failure → 403, never silently proceed

### State Lifecycle Risks

- Cache is in-memory → lost on restart. This is fine — it's just a performance optimization.
- CSRF tokens are in cookies → cleared on logout. No orphaned state.
- Removing AI SDK tool exports is a breaking change for any external consumer of those exports. But since Tiburcio is self-contained, only `nightly-review.ts` is affected.

### API Surface Parity

- `getFileContext` and `validateCode` must be registered in both `mcp-tools.ts` (MCP) and available as execute functions for potential internal use
- The CSRF middleware must NOT apply to `/mcp` routes (Bearer auth, not cookies)
- The cache layer must be shared between MCP and AI SDK tool usage (nightly review calls)

### Integration Test Scenarios

1. **Cold start with no indexes** → `getFileContext` returns helpful empty state, not an error
2. **Neo4j down + getFileContext** → returns conventions and reviews without dependents
3. **validateCode with no standards indexed** → returns pass with "no conventions to check against" message
4. **Cache hit after reindex** → cache cleared, fresh results returned
5. **CSRF token mismatch on chat endpoint** → 403 returned, MCP endpoint unaffected

---

## Acceptance Criteria

### Functional Requirements

- [ ] `getFileContext(filePath)` returns conventions, reviews, dependents, patterns in a single call (<3s)
- [ ] `getFileContext` with `scope: "conventions"` returns only conventions (<1.5s)
- [ ] `getFileContext` reports `stale: true` when file was modified after indexing
- [ ] `validateCode(code, filePath)` returns structured violations against indexed standards
- [ ] `validateCode` timeout (>10s) returns graceful "unavailable" response, not an error
- [ ] All 12 tools (10 existing + 2 new) work from first boot with fallbacks
- [ ] AI SDK tool objects removed from individual tool files (only `executeFoo` remains)
- [ ] `nightly-review.ts` defines its own inline AI SDK tools for the review step
- [ ] `mcp-tools.ts` is the single source of truth for all tool schemas and descriptions

### Non-Functional Requirements

- [ ] CSRF double-submit cookie protection on all `/api/*` POST/PUT/DELETE routes
- [ ] Startup warning logged when production credentials match defaults
- [ ] MCP endpoint has its own rate limiter (60 req/min)
- [ ] Response cache reduces repeated query latency by >80%
- [ ] Cache automatically clears after any index job completes
- [ ] Tool descriptions include "when to use this vs built-in tools" guidance
- [ ] Cross-tool suggestions in searchStandards and searchCode responses

### Quality Gates

- [ ] All existing 137+ backend tests pass
- [ ] New tests for getFileContext, validateCode, CSRF middleware, cache (est. +350 lines)
- [ ] `pnpm check` passes in both backend and frontend
- [ ] CLAUDE.md updated with new tool descriptions and version bump to v3.0.0
- [ ] Version updated consistently: backend/package.json, frontend/package.json, server.ts, mcp.ts

---

## Success Metrics

**The real metric:** Do I (Claude Code) reach for Tiburcio tools more than 50% of the time when working on code tasks?

Proxy metrics:
- `getFileContext` becomes the most-called tool (tracked via Langfuse)
- `validateCode` catches at least 1 convention violation per session
- Average tool response time <2s (cached) / <3s (uncached)
- Zero tools return empty/error on first boot
- Tool description changes reduce "wrong tool called" rate

---

## Dependencies & Prerequisites

- v2.2 must be stable (current state — clean git, tests passing)
- Neo4j graph layer must be wired up (from previous plan — already done in v2.2)
- Standards collection must have content (already auto-indexed on startup)
- No new infrastructure dependencies — everything uses existing Qdrant, Redis, Neo4j, LLM

---

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| `getFileContext` is too slow (5+ parallel internal calls) | High — won't be used if >3s | Use scope parameter to limit calls. Cache aggressively. |
| `validateCode` LLM quality is poor with 8B model | Medium — false positives reduce trust | Support `REVIEW_MODEL` env var for better model. Validate against standards only (scoped). |
| Removing AI SDK tool exports breaks something unexpected | Low — codebase is self-contained | Search all imports before removing. Keep execute functions unchanged. |
| CSRF protection breaks frontend | Medium — auth flow breaks | Test login/register/chat flows. Exempt auth endpoints. |
| Cache serves stale data | Low — max 5 min for standards | Clear on reindex. Short TTL for code. |

---

## Implementation Phases

### Phase 1: Context Bundle (est. effort: medium)

1. Create `get-file-context.ts` with parallel internal calls
2. Register in `mcp-tools.ts`
3. Write tests
4. Update CLAUDE.md with new tool

### Phase 2: Active Guard (est. effort: medium)

1. Create `validate-code.ts` with standards retrieval + LLM validation
2. Register in `mcp-tools.ts`
3. Write tests
4. Update CLAUDE.md

### Phase 3: Architecture Purity (est. effort: small)

1. Remove AI SDK tool exports from all tool files
2. Define inline tools in `nightly-review.ts`
3. Verify all tests pass
4. Update CLAUDE.md

### Phase 4: Security (est. effort: small)

1. Add CSRF middleware
2. Add credential warnings
3. Add MCP rate limiter
4. Write tests

### Phase 5: Performance & Polish (est. effort: medium)

1. Add response cache
2. Update tool descriptions
3. Add cross-tool suggestions
4. Add `REVIEW_MODEL` env var
5. Version bump to v3.0.0

---

## What NOT to Do

- **Don't add MCP resources/prompts/instructions yet.** Claude Code's support for these is limited. Tools are the proven pattern. Resources can be explored in v3.1 when MCP spec stabilizes.
- **Don't rewrite the nightly pipeline.** The "enriched change records instead of AI reviews" idea is good but too big for v3. Keep the current pipeline, just add `REVIEW_MODEL` for quality.
- **Don't add more Qdrant collections.** 6 is enough. `getFileContext` composes existing collections, not new ones.
- **Don't add a chat layer to MCP.** Tiburcio is a tool provider. Claude Code is the chat layer.
- **Don't try to replace Grep/Read.** They're faster for exact matches. Tiburcio complements them.

---

## Sources & References

### Internal References

- Previous improvement plan: `docs/plans/2026-03-08-feat-claude-preferred-mcp-improvements-plan.md`
- MCP tools registration: `backend/src/mcp-tools.ts`
- Nightly review pipeline: `backend/src/mastra/workflows/nightly-review.ts`
- Tool implementations: `backend/src/mastra/tools/`
- Model provider: `backend/src/lib/model-provider.ts`
- Infrastructure singletons: `backend/src/mastra/infra.ts`
- Graph builder: `backend/src/graph/builder.ts`
- BullMQ jobs: `backend/src/jobs/queue.ts`

### Design Principles (from CLAUDE.md)

- Maintainability over performance
- Simplicity — fewer moving parts
- Single source of truth
- Consistency across everything
- Production-ready — bulletproof edge cases
