---
status: complete
priority: p3
issue_id: "032"
tags: [code-review, performance]
dependencies: []
---

# getGitCommitSummaries iterates repos sequentially instead of in parallel

## Problem Statement

`git-fallback.ts:getGitCommitSummaries()` uses `for...of` to iterate repos sequentially. With 3+ repos and many commits, this means 150+ sequential git process spawns (3-8 seconds).

Only affects first-boot fallback path (not hot path), so low priority.

## Findings

- **Source**: Performance oracle (#1)

## Proposed Solutions

### Option A: Use `Promise.all` for repo-level parallelism
- **Effort**: Small
- **Pros**: 3x faster for 3 repos

## Acceptance Criteria

- [ ] Repos processed in parallel with `Promise.all`
