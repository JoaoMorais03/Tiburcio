---
status: complete
priority: p3
issue_id: "018"
tags: [code-review, performance]
dependencies: []
---

# Graph Builder Accumulates All Nodes/Edges in Memory Before Upserting

## Problem Statement

`graph/builder.ts` accumulates `allNodes` and `allEdges` across the entire repo before calling any upsert. For a 2000-file codebase with ~10 nodes/edges per file, this holds 20,000+ objects plus file content strings in memory simultaneously. `BATCH_SIZE = 500` controls only the Cypher write batch size, not memory growth during the read phase.

## Findings

**File:** `backend/src/graph/builder.ts:128-145`
```typescript
const allNodes: GraphData["nodes"] = [];
const allEdges: GraphData["edges"] = [];

for (const relPath of filePaths) {
  const { nodes, edges } = extractGraph(...);
  allNodes.push(...nodes);  // unbounded accumulation
  allEdges.push(...edges);
}

await batchUpsertNodes(allNodes);  // then flush everything
```

At 10,000 files, this could hold 50-100MB of node/edge data + file content in heap simultaneously.

## Proposed Solutions

### Process and upsert in file-level batches (Recommended)
Process 100 files at a time, calling `batchUpsertNodes`/`batchUpsertEdges` after each batch before clearing the arrays.

**Effort:** Small | **Risk:** Low (idempotent upserts — MERGE semantics)

## Acceptance Criteria

- [ ] Graph builder does not accumulate unbounded node/edge arrays
- [ ] Memory usage during graph build is bounded by batch size, not total codebase size
- [ ] Graph rebuild produces identical results

## Work Log

- 2026-03-06: Found by performance-oracle review agent
