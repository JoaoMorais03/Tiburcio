---
title: "feat: MCP Tools Reliability, First-Boot Experience, and Quality-of-Life Fixes"
type: feat
status: completed
date: 2026-03-08
---

# MCP Tools Reliability, First-Boot Experience, and Quality-of-Life Fixes

## Overview

Real-world testing of all 10 MCP tools revealed that **40% return nothing on a fresh install**, layer filters are a usability trap, only 2 patterns exist, and `getImpactAnalysis` is permanently broken without manual intervention. For a team of 8 developers relying on Tiburcio daily, this is unacceptable. This plan fixes every tool to deliver value from first boot.

## Problem Statement

Tested every tool with realistic developer scenarios. Results:

| Tool | Fresh Install | Verdict |
|------|--------------|---------|
| searchCode | Works (8/10) | Good — hybrid search finds relevant code |
| searchSchemas | Works (8/10) | Good — clean table definitions |
| getArchitecture | Works (7/10) | Good — clear system overview |
| getPattern | Works but empty (3/10) | Only 2 patterns — useless for most tasks |
| searchStandards | Works but unreliable (5/10) | Returns irrelevant results when no good match exists |
| getNightlySummary | **Dead** (0/10) | Returns "not indexed yet" |
| getChangeSummary | **Dead** (0/10) | Returns "not indexed yet" |
| searchReviews | **Dead** (0/10) | Returns "not indexed yet" |
| getTestSuggestions | **Dead** (0/10) | Returns "not indexed yet" |
| getImpactAnalysis | **Dead** (0/10) | Neo4j never has data |

**Root cause**: 4 tools depend entirely on the nightly pipeline having completed at least once. The nightly pipeline runs at 2 AM. If it fails (LLM timeout, Qdrant conflict, inference rate limit), no one notices and the tools stay dead. `getImpactAnalysis` depends on Neo4j being configured AND the nightly pipeline having built the graph.

## Proposed Solution

Three phases targeting different pain points:

### Phase 1 — Make Every Tool Return Something Useful (P1)

**1.1 Git-based fallbacks for nightly-dependent tools**

When Qdrant collections `reviews` or `test-suggestions` have zero points, fall back to raw git data from `CODEBASE_REPOS`. This ensures these 4 tools always return *something* on first boot.

**Fallback trigger**: Collection does not exist OR `scroll()` with no filter returns zero total points. A query-specific zero-result (query doesn't match anything in a populated collection) is NOT a fallback trigger — that's just a bad query.

**Fallback mapping**:

| Tool | Fallback data source | Output |
|------|---------------------|--------|
| `getNightlySummary` | `git log --since=Xd --oneline --stat` across all repos | Commit count, files changed, top authors. Adds `source: "git-log"` field |
| `getChangeSummary` | `git log --since=X --pretty=format:... --stat` | Commits grouped by area (first directory), author list |
| `searchReviews` | No semantic fallback possible. Return honest message + recent commits from `git log --oneline -10` as context | `source: "git-log"`, message explaining AI review not yet available |
| `getTestSuggestions` | No on-demand LLM generation (too slow, defeats cached lookup). Return recently changed test-adjacent files from `git diff --name-only` filtered to `*test*`, `*spec*` | `source: "git-log"`, list of recently changed files near tests |

**Key design decisions**:
- Same response shape as normal mode, with added `source: "git-log"` and `notice` fields
- Git operations use existing `git-diff.ts` utilities (`getRecentCommits`, `getChangedFiles`)
- Fallback is fast (<1s vs nightly pipeline minutes) — no LLM calls
- `CODEBASE_REPOS` must be configured for fallback to work (already required for indexing)

**New file**: `backend/src/mastra/tools/git-fallback.ts` — shared fallback utilities

**Modified files**:
- `backend/src/mastra/tools/get-nightly-summary.ts` — add fallback after empty collection check
- `backend/src/mastra/tools/get-change-summary.ts` — add fallback after empty scroll
- `backend/src/mastra/tools/search-reviews.ts` — add fallback in catch block + empty results
- `backend/src/mastra/tools/get-test-suggestions.ts` — add fallback in catch block + empty results

**1.2 Auto-build Neo4j graph after codebase indexing**

Currently the graph only builds during step 4 of the nightly pipeline. Add a `buildGraph()` call at the end of the `index-codebase` job in `queue.ts`, gated by `isGraphAvailable()`. This means `getImpactAnalysis` works as soon as codebase indexing finishes — no need to wait for 2 AM.

**Modified files**:
- `backend/src/jobs/queue.ts` — add `buildGraph()` call after `indexCodebase()` in the `index-codebase` case

**1.3 Add 8 new code patterns**

Current state: 2 patterns (`new-api-endpoint`, `new-vue-page`). Target: 10 patterns covering every common task a developer on this team would encounter.

**New patterns** (in `standards/patterns/`):
- [ ] `new-test-file.md` — Vitest test with mocking patterns (mock Qdrant, embedText, model-provider)
- [ ] `new-mcp-tool.md` — New RAG tool following the tools import pattern (embedText + rawQdrant + truncate)
- [ ] `new-bullmq-job.md` — Add a new BullMQ job type to queue.ts
- [ ] `new-drizzle-migration.md` — Schema change → `pnpm db:generate` → migration workflow
- [ ] `new-indexer.md` — New indexing pipeline per collection (embed, upsert, ensureCollection)
- [ ] `new-qdrant-collection.md` — Add a new Qdrant collection (infra.ts + ensureCollection)
- [ ] `new-vue-component.md` — shadcn-vue component with Tailwind v4
- [ ] `new-middleware.md` — Hono middleware (rate limiter, auth guard)

Each pattern follows the existing structure: `## Steps` (numbered with code blocks) + `## Conventions` (bullet points). All patterns are project-specific to Tiburcio conventions, not generic.

### Phase 2 — Search Quality and UX (P2)

**2.1 searchStandards low-confidence handling**

Current: returns empty results with `"No high-confidence results found"` when below threshold (0.45). Problem: Claude gets nothing, tries again, wastes context.

**Fix**: Return results with `lowConfidence: true` flag + a notice. Let Claude decide whether the results are useful. Don't hide information — expose it with a warning.

```typescript
if (topScore < threshold) {
  return {
    results: results.map(mapResult),
    lowConfidence: true,
    notice: `Results have low relevance (best: ${topScore.toFixed(2)}, threshold: ${threshold}). Consider rephrasing or using searchCode for implementations.`,
  };
}
```

**Modified files**: `backend/src/mastra/tools/search-standards.ts`

**2.2 Layer filter UX improvement**

Current: `layer` enum with 19 values. Wrong guess = empty results. No documentation of what maps where.

**Fix** (three changes):
1. **Update the layer description** to include path mapping hints: `"Architectural layer. Inferred from file path: service=*/services/*, controller=*/routes/*, repository=*/repository/*, model=*/model/*, config=*/config/*. Omit for best results — hybrid search usually finds the right layer."`
2. **Add `"any"` as default** — when `layer` is omitted or `"any"`, no filter is applied (current behavior, just make it explicit)
3. **Log actual layers** in compact mode results so Claude can see what layer was assigned: add `layer` to compact result shape

**Modified files**: `backend/src/mastra/tools/search-code.ts`, `backend/src/mcp-tools.ts`

**2.3 Remove dead `change-summary` category from searchReviews**

The `category` enum includes `"change-summary"` but the nightly review system prompt never generates this category. Remove it to avoid confusing Claude.

**Modified files**: `backend/src/mastra/tools/search-reviews.ts`, `backend/src/mcp-tools.ts`

**2.4 Nightly pipeline health tracking**

Pipeline failures are invisible — logged to stdout but nobody checks at 3 AM. Add Redis-based health tracking so the health endpoint and Langfuse can surface failures.

**Implementation**:
- After nightly pipeline completes: set `tiburcio:nightly:last-run` (ISO timestamp), `tiburcio:nightly:last-status` (`"ok"` | `"failed"`), `tiburcio:nightly:last-error` (error message, cleared on success) in Redis
- Extend `/api/health` response with `pipeline: { lastRun, status, error? }`
- No authentication needed — just timestamp and status, no sensitive details

**Modified files**:
- `backend/src/mastra/workflows/nightly-review.ts` — set Redis keys on completion/failure
- `backend/src/server.ts` — extend health endpoint to read pipeline keys

### Phase 3 — Future Enhancements (P3, not in this PR)

**3.1 Context bundle meta-tool (`getContext`)**

One call that intelligently combines `searchStandards` + `searchCode` + `getArchitecture` + `getPattern` based on query semantics. Returns complete context in a single response. Deferred — needs real usage data from the team of 8 to determine which tools to auto-combine.

**3.2 Convention checker (`checkConventions`)**

Active validation of code snippets against standards. Deferred — requires prompt engineering and cost analysis for LLM calls per invocation.

## Technical Considerations

### Git fallback performance
- Git operations are sub-second on repos <10k files
- `getRecentCommits()` already exists and is tested in the nightly pipeline
- Fallback adds ~100-500ms to tool calls when Qdrant is empty — acceptable for first-boot UX
- For multi-repo setups (3 repos), fallback iterates all repos — still <2s total

### Neo4j graph build timing
- Graph build takes <5s for ~500 files (418 nodes, 647 edges measured)
- For large monoliths (5k files), could take 30-60s
- Runs inside BullMQ worker (concurrency: 1), so it blocks other jobs during build
- This is acceptable — graph build is infrequent (only on full reindex or nightly)

### Pattern quality
- Patterns are project-specific, not generic — they reference Tiburcio's actual conventions
- Must be updated when conventions change (same rule as CLAUDE.md and standards/)
- Pattern names match natural language: "how do I add a new test?" → `getPattern("new-test-file")`

### Score threshold stability
- Threshold 0.45 works for `nomic-embed-text` (Ollama) and `qwen3-embedding-8b` (OpenRouter)
- Switching embedding models may require threshold recalibration
- Returning low-confidence results with a flag (2.1) is more robust than adjusting thresholds per model

## System-Wide Impact

- **Interaction graph**: Git fallback functions call `execFile` (spawns git subprocess) — no callbacks or middleware involved. Safe from interaction side effects.
- **Error propagation**: All fallback paths are wrapped in try/catch. A git command failure falls through to the existing "unable to generate" error message. No new error classes introduced.
- **State lifecycle risks**: Fallbacks are read-only (git log queries). No state is persisted. No risk of orphaned data.
- **API surface parity**: Both MCP transports (stdio and HTTP/SSE) use the same `executeFoo()` functions — fallbacks apply equally to both. The chat UI tools also import the same functions, so they benefit too.
- **Integration test scenarios**: Need tests for (a) empty Qdrant + available git repos → fallback activates, (b) empty Qdrant + no CODEBASE_REPOS → graceful "no data" message, (c) populated Qdrant → normal path (no fallback).

## Acceptance Criteria

### Phase 1

- [x] `getNightlySummary` returns git-based commit summary when `reviews` collection is empty
- [x] `getChangeSummary` returns git-based change list when `reviews` collection is empty
- [x] `searchReviews` returns recent git commits when `reviews` collection is empty
- [x] `getTestSuggestions` returns recently changed test files when `test-suggestions` collection is empty
- [x] All 4 fallback responses include `source: "git-log"` and a `notice` explaining reduced fidelity
- [x] Fallback does NOT activate when collection exists and has data (even if query returns nothing)
- [x] `getImpactAnalysis` returns real data after codebase indexing (when Neo4j is configured)
- [x] Graph auto-builds after `index-codebase` job completes (gated by `isGraphAvailable()`)
- [x] All 10 patterns exist in `standards/patterns/` and are returned by `getPattern()`
- [x] Each new pattern follows existing structure (Steps + Conventions + code blocks)
- [x] All existing tests pass (137 backend, 30 frontend)
- [x] New tests cover each fallback path

### Phase 2

- [x] `searchStandards` returns low-confidence results with `lowConfidence: true` flag instead of empty
- [x] `searchCode` layer filter description includes path mapping hints
- [x] `searchCode` compact results include `layer` field
- [x] `change-summary` removed from `searchReviews` category enum
- [x] `/api/health` includes `pipeline` section with `lastRun`, `status`, `error`
- [x] Nightly pipeline writes health status to Redis on completion and failure

## Success Metrics

- **First-boot**: 10/10 tools return useful data within 30 minutes of first `docker compose up` (vs 4/10 today)
- **Day-2**: All 10 tools return full AI-enriched data after first nightly pipeline run
- **Relevance**: `searchStandards` no longer returns completely unrelated results — low-confidence results are flagged
- **Patterns**: `getPattern()` returns 10 patterns covering every common team task

## Dependencies & Risks

| Risk | Mitigation |
|------|-----------|
| Git fallback requires `CODEBASE_REPOS` paths accessible at runtime | Already required for indexing — same constraint. Document clearly. |
| Graph build after indexing blocks BullMQ worker | <5s for typical repos. For large monoliths, acceptable delay vs permanently broken tool. |
| New patterns may become stale | Same maintenance burden as existing standards/. Document in CONTRIBUTING.md. |
| Low-confidence results from searchStandards may confuse Claude | `lowConfidence: true` flag lets Claude decide. Better than returning nothing. |
| Multi-repo fallback runs git on all repos | Use `Promise.all` for parallelism. <2s even for 3 repos. |

## Implementation Estimate

| Phase | Items | Effort |
|-------|-------|--------|
| Phase 1.1 | Git fallbacks (4 tools + shared utility) | Medium — ~200 lines new code + ~80 lines modified |
| Phase 1.2 | Neo4j auto-build | Small — ~10 lines in queue.ts |
| Phase 1.3 | 8 new patterns | Medium — ~800 lines of markdown (documentation, not code) |
| Phase 2.1 | searchStandards low-confidence | Small — ~10 lines |
| Phase 2.2 | Layer filter UX | Small — description changes + 1 field added |
| Phase 2.3 | Remove dead enum value | Small — 2 files |
| Phase 2.4 | Pipeline health tracking | Small — ~30 lines Redis + ~15 lines health endpoint |
| Tests | Fallback tests + graph build test | Medium — ~100 lines |

**Total: ~1,250 lines across 15 files + 8 new pattern files**

## Sources & References

- Honest review testing session: called all 10 tools with real scenarios, documented failures
- Existing git utilities: `backend/src/indexer/git-diff.ts` (getRecentCommits, getChangedFiles, etc.)
- Existing patterns: `standards/patterns/new-api-endpoint.md`, `standards/patterns/new-vue-page.md`
- Previous MCP improvements plan: `docs/plans/2026-03-08-feat-claude-preferred-mcp-improvements-plan.md`
- Score threshold config: `backend/src/config/env.ts:53-55` (RETRIEVAL_CONFIDENCE_THRESHOLD=0.45, RETRIEVAL_CODE_SCORE_THRESHOLD=0.02)
- First-boot auto-index: `backend/src/server.ts:163-198`
- Nightly pipeline: `backend/src/mastra/workflows/nightly-review.ts:511` (runNightlyReview)
- BullMQ jobs: `backend/src/jobs/queue.ts:67-83` (cron schedule)
