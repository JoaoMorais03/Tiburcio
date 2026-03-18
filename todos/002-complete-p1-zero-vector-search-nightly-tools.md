---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, bug, performance, architecture]
dependencies: []
---

# Zero-Vector Search Used Instead of Scroll in Nightly Summary Tools

## Problem Statement

`getNightlySummary` and `getChangeSummary` fetch results from Qdrant by searching with a zero vector (`new Array(dims).fill(0)`). A zero vector has mathematically undefined cosine similarity — Qdrant returns results in implementation-defined order, not by recency or relevance. As the `reviews` and `test-suggestions` collections grow, this approach will silently omit critical items. The correct approach is `rawQdrant.scroll()` with a date-range filter.

## Findings

**File:** `backend/src/mastra/tools/get-nightly-summary.ts:76-83`
```typescript
const zeroVec = new Array(dims).fill(0);
const [reviews, testSuggestions] = await Promise.all([
  rawQdrant.search("reviews", { vector: zeroVec, limit: 50, with_payload: true }).catch(() => []),
```

**File:** `backend/src/mastra/tools/get-change-summary.ts:81`
Same zero-vector pattern.

`rawQdrant.scroll()` is already used in `backend/src/indexer/index-codebase.ts:363` — the API is available.

## Proposed Solutions

### Option A: Replace search() with scroll() + date filter (Recommended)
```typescript
const scrollResult = await rawQdrant.scroll("reviews", {
  filter: { must: [{ key: "date", range: { gte: cutoffStr } }] },
  limit: 50,
  with_payload: true,
});
const reviews = scrollResult.points;
```

**Pros:** Correct semantics, deterministic results, uses date filter at DB level
**Effort:** Small
**Risk:** Low

### Option B: Keep search but use scroll as fallback
No — scroll is clearly correct here. Don't keep the zero-vector hack.

## Technical Details

- **Affected files:** `backend/src/mastra/tools/get-nightly-summary.ts`, `backend/src/mastra/tools/get-change-summary.ts`
- **Note:** Post-retrieval date filtering can be removed from these tools after moving filter into scroll call

## Acceptance Criteria

- [ ] `get-nightly-summary.ts` uses `rawQdrant.scroll()` with a date range filter
- [ ] `get-change-summary.ts` uses `rawQdrant.scroll()` with a date range filter
- [ ] No zero vectors in production code
- [ ] Results are deterministically ordered by date (most recent first)

## Work Log

- 2026-03-06: Found by performance-oracle + architecture-strategist review agents
