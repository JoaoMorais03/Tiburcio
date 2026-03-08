---
status: complete
priority: p1
issue_id: "007"
tags: [code-review, performance]
dependencies: []
---

# Sequential Incremental Reindex in Nightly Pipeline — No p-limit Parallelism

## Problem Statement

The nightly pipeline's incremental reindex in `nightly-review.ts` processes changed files in a bare `for` loop with `await` at every step: delete → chunk → contextualize → embed → upsert — all sequential. The full indexer (`index-codebase.ts`) uses `p-limit(3)` for 3× speedup. With 50 changed files overnight, each needing up to 30s of LLM contextualization, the nightly pipeline becomes the primary bottleneck before code review even starts.

## Findings

**File:** `backend/src/mastra/workflows/nightly-review.ts:146-229`

Per-file pipeline is sequential:
```typescript
for (const [filePath, repoName] of changedFiles) {
  // delete + chunk + contextualize + embed + upsert — all await'd sequentially
}
```

Full indexer for comparison (`backend/src/indexer/index-codebase.ts`):
```typescript
await Promise.all(files.map(limit(async (file) => { ... })));
// p-limit(3) — 3 concurrent file pipelines
```

Worst case: 50 files × 30s contextualization = 25 minutes just for reindex, before review generation starts.

## Proposed Solutions

### Option A: Wrap nightly reindex with p-limit(3) (Recommended)
Import `p-limit` and wrap the per-file pipeline exactly like `index-codebase.ts` does. The LLM contextualization already has its own 30s abort timeout per chunk.

**Pros:** 3× speedup, matches the established pattern in the codebase, safe for inference rate limits
**Effort:** Small
**Risk:** Low

### Option B: Extract shared processFile() utility from index-codebase.ts
Move the per-file logic to a shared function so nightly-review.ts and index-codebase.ts share the same code path.

**Pros:** DRY, single implementation to maintain
**Cons:** Slightly more refactoring surface
**Effort:** Medium

## Technical Details

- **Affected file:** `backend/src/mastra/workflows/nightly-review.ts`
- **Note:** Also fix the `enrichChunkForEmbedding` called twice per point (see separate todo)

## Acceptance Criteria

- [ ] Nightly incremental reindex uses `p-limit(3)` (or similar) for file-level parallelism
- [ ] Wall-clock time for 50 changed files is ≤ 1/3 of the sequential baseline
- [ ] `pnpm test` still passes

## Work Log

- 2026-03-06: Found by performance-oracle review agent
