---
status: complete
priority: p2
issue_id: "029"
tags: [code-review, quality, bug]
dependencies: []
---

# sinceToHours silently defaults to 24h on ISO date input

## Problem Statement

`git-fallback.ts:sinceToHours()` only handles `d/w/m` suffixes. When `getChangeSummary` passes an ISO date like `"2026-01-15"`, the regex doesn't match and it silently returns 24. The git fallback only looks at 24 hours of history regardless of what the user actually requested.

Also duplicates logic from `parseSince()` in `get-change-summary.ts` — violates "single source of truth".

## Findings

- **Source**: TypeScript reviewer (#6), Code-simplicity reviewer (#1)

## Proposed Solutions

### Option A: Handle ISO dates in `sinceToHours` (Recommended)
```typescript
export function sinceToHours(since: string): number {
  const match = since.match(/^(\d+)([dwm])$/);
  if (match) { /* existing logic */ }
  // Try ISO date
  const date = new Date(since);
  if (!isNaN(date.getTime())) {
    return Math.max(1, (Date.now() - date.getTime()) / 3_600_000);
  }
  return 24;
}
```
- **Effort**: Small (5 lines)

### Option B: Consolidate with `parseSince` into shared utility
- **Effort**: Medium
- **Pros**: Single source of truth

## Acceptance Criteria

- [ ] `sinceToHours("2026-01-15")` returns correct hour difference
- [ ] Unit tests cover ISO dates, relative strings, and invalid input
