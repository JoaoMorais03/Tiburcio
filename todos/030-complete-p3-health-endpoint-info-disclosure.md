---
status: complete
priority: p3
issue_id: "030"
tags: [code-review, security]
dependencies: []
---

# Health endpoint exposes infrastructure details without authentication

## Problem Statement

`/api/health` is unauthenticated and exposes: whether Langfuse is configured, pipeline last-run timestamp, and individual component status (database, redis, qdrant). While low risk, this contradicts the code comment "no internal technology details."

## Findings

- **Source**: Security sentinel (MEDIUM-1), TypeScript reviewer (#14)

## Proposed Solutions

### Option A: Strip internal details from public endpoint
Return only `{ status: "ok"|"degraded", timestamp }` publicly. Move detailed health to `/api/admin/health`.
- **Effort**: Small

### Option B: Accept the risk (document the decision)
Component names and timestamps are not exploitable. Add a code comment acknowledging the trade-off.
- **Effort**: Trivial

## Acceptance Criteria

- [ ] Decision documented in code comment or health endpoint simplified
