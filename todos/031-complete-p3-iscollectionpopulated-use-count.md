---
status: complete
priority: p3
issue_id: "031"
tags: [code-review, performance]
dependencies: []
---

# isCollectionPopulated uses scroll instead of count for existence check

## Problem Statement

`git-fallback.ts:isCollectionPopulated()` calls `rawQdrant.scroll(collection, { limit: 1 })` which fetches actual point data. `rawQdrant.count()` or `getCollection()` would be cheaper, especially on large collections.

## Findings

- **Source**: TypeScript reviewer (#3), Performance oracle (#2)
- **Real impact**: Sub-millisecond difference on local Qdrant. Low priority.

## Proposed Solutions

### Option A: Use `rawQdrant.count()` instead
```typescript
const { count } = await rawQdrant.count(collection);
return count > 0;
```
- **Effort**: Trivial (1 line change)

## Acceptance Criteria

- [ ] `isCollectionPopulated` uses count instead of scroll
