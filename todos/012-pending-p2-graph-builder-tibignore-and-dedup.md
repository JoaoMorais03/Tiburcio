---
status: complete
priority: p2
issue_id: "012"
tags: [code-review, performance, architecture]
dependencies: []
---

# Graph Builder Ignores .tibignore + Duplicated findSourceFiles Logic

## Problem Statement

`graph/builder.ts` has its own `findSourceFiles` implementation that doesn't apply `.tibignore` patterns and uses a slightly different `SKIP_DIRS` set than `index-codebase.ts`. Files explicitly excluded from vector indexing will still be processed by the graph builder. This is both a correctness issue (unexpected graph nodes from excluded files) and a performance issue (wasted I/O).

## Findings

**File:** `backend/src/graph/builder.ts:15-25` — `SKIP_DIRS` is missing `docs`, `cicd`, `.mvn`, `.vscode`, `.claude` that the indexer skips

**File:** `backend/src/indexer/index-codebase.ts:109-143` — has `.tibignore` pattern loading and application

Two copies of `findSourceFiles` with different behavior will keep drifting.

## Proposed Solutions

### Option A: Import .tibignore loading from indexer into graph builder
In `graph/builder.ts`, import the `.tibignore` pattern loader from `indexer/` and apply it:
```typescript
import { loadTibignorePatterns, matchesPattern } from "../indexer/index-codebase.js";
```

**Pros:** Consistent exclusion behavior, no duplicate logic
**Effort:** Small
**Risk:** Low

### Option B: Extract shared findSourceFiles utility
Create `indexer/find-files.ts` with a single `findSourceFiles(dir, baseDir, options)` that both callers use.

**Pros:** Cleanest, single source of truth
**Effort:** Medium
**Risk:** Low

## Technical Details

- **Affected files:** `backend/src/graph/builder.ts`, `backend/src/indexer/index-codebase.ts`

## Acceptance Criteria

- [ ] Files matching `.tibignore` patterns are excluded from graph building
- [ ] `SKIP_DIRS` is consistent between indexer and graph builder
- [ ] No duplicated `findSourceFiles` implementations

## Work Log

- 2026-03-06: Found by performance-oracle + architecture-strategist review agents
