---
status: complete
priority: p1
issue_id: "006"
tags: [code-review, performance, architecture]
dependencies: []
---

# O(n²) Linear Scan for Node Deduplication in Graph Extractor

## Problem Statement

`graph/extractor.ts` deduplicates graph nodes using `nodes.find((n) => n.id === nodeId)` inside the hot per-file extraction loop. This is O(n²) over the accumulated nodes array. For a 500-file codebase with ~4 nodes/file, that's ~4.9M comparisons for node deduplication alone. At 2000+ files it becomes a multi-minute bottleneck.

## Findings

**File:** `backend/src/graph/extractor.ts:62, 122-123, 134-136, 166-168`

The `upsertTableRef`, `extractTypeScript`, and `extractJava` functions all use `nodes.find()` for deduplication. The `allNodes` array accumulates across ALL files in `graph/builder.ts`, so the `find()` scan operates over the full cross-file node set.

Performance projection:
- 558 files × 4 nodes × 2200 total nodes ≈ **4.9M comparisons** at current codebase size
- 2000 files × 4 nodes × 8000 total nodes ≈ **64M comparisons** — graph build becomes 13× slower

## Proposed Solutions

### Option A: Replace nodes array with a Map keyed by id (Recommended)
Change the `nodes` parameter in extractor functions from `GraphNode[]` to a `Map<string, GraphNode>`. Add with `map.set(id, node)` instead of `find()` check. Return `[...map.values()]` at the end.

**Pros:** O(1) dedup, trivial refactor, eliminates the growth curve entirely
**Effort:** Small
**Risk:** Low

### Option B: Use a Set<string> for seen IDs alongside the array
Keep the array, add a `Set<string>` for ID tracking. Check `seenIds.has(id)` before `push`.

**Pros:** Minimal change to existing array-based API
**Effort:** Small
**Risk:** Low

## Technical Details

- **Affected files:** `backend/src/graph/extractor.ts`, `backend/src/graph/builder.ts` (caller)

## Acceptance Criteria

- [ ] `nodes.find()` calls replaced with O(1) set/map lookup in all 4 dedup sites
- [ ] Graph build time is linear in file count, not quadratic
- [ ] Graph extractor still produces correct deduplicated node lists

## Work Log

- 2026-03-06: Found by TypeScript reviewer + performance-oracle review agents
