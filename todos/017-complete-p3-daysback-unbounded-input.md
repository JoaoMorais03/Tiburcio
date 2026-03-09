---
status: complete
priority: p3
issue_id: "017"
tags: [code-review, security, quality]
dependencies: []
---

# Unbounded daysBack Parameter and Unvalidated ISO Date in Nightly Tools

## Problem Statement

`getNightlySummary` accepts `daysBack` as `z.number().default(1)` with no `.max()`. `getChangeSummary` accepts `since` as a free-form string; invalid dates result in a `NaN` comparison that silently fails open (all records pass the filter).

## Findings

**File:** `backend/src/mastra/tools/get-nightly-summary.ts` — `daysBack: z.number().default(1)` (no max)
**File:** `backend/src/mastra/tools/get-change-summary.ts` — `since` accepts any string, invalid ISO dates produce NaN comparisons

Also: both files use zero-vector search (see todo #002) which compounds the issue.

## Proposed Solutions

### Add .max() and validate ISO date (Recommended)
```typescript
daysBack: z.number().min(1).max(90).default(1)
```
In `parseSince()`, validate ISO date format:
```typescript
const d = new Date(since);
if (isNaN(d.getTime())) return new Date(0); // or throw
```

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] `daysBack` has a `.max(90)` constraint in the Zod schema
- [ ] Invalid `since` ISO dates produce a clear error response, not silent fail-open
- [ ] CLAUDE.md tools section mentions the max constraint

## Work Log

- 2026-03-06: Found by security-sentinel review agent
