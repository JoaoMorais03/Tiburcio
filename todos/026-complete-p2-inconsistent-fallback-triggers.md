---
status: complete
priority: p2
issue_id: "026"
tags: [code-review, architecture, consistency, mcp]
dependencies: []
---

# Inconsistent fallback triggering across 4 nightly-dependent tools

## Problem Statement

The 4 tools with git fallbacks use different trigger conditions:

| Tool | Trigger | Uses `isCollectionPopulated`? |
|------|---------|------------------------------|
| `searchReviews` | `catch` block (Qdrant error) | No |
| `getTestSuggestions` | `catch` block (Qdrant error) | No |
| `getNightlySummary` | Empty scroll results | No |
| `getChangeSummary` | Empty results + `isCollectionPopulated()` | Yes |

This means: if the `reviews` collection exists but is empty, `searchReviews` will NOT fall back (returns "no insights found"), but `getChangeSummary` WILL fall back (shows git data). Two tools querying the same collection behave differently in the same state.

## Findings

- **Source**: TypeScript reviewer (#5), Architecture strategist, Pattern-recognition specialist, Code-simplicity reviewer — ALL 4 flagged this independently
- **Evidence**: Each tool file's fallback implementation
- **Impact**: Confusing UX where same system state produces different behavior across tools

## Proposed Solutions

### Option A: Standardize on `isCollectionPopulated()` check (Recommended)
All 4 tools: try Qdrant → if results empty AND `isCollectionPopulated()` returns false → fall back.
- **Effort**: Small (modify 3 tools)
- **Risk**: Low
- **Pros**: Consistent, predictable behavior

### Option B: Standardize on catch-only fallback
Remove `isCollectionPopulated()` entirely. Only fall back when Qdrant throws (collection doesn't exist).
- **Effort**: Small
- **Risk**: Misses case where collection exists but has 0 points
- **Cons**: Less reliable first-boot experience

## Acceptance Criteria

- [ ] All 4 tools use the same fallback trigger pattern
- [ ] Fallback activates when collection is empty (0 points), not just when collection doesn't exist
- [ ] Fallback does NOT activate when collection has data but query returns 0 results
