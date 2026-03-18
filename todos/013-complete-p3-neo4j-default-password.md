---
status: complete
priority: p3
issue_id: "013"
tags: [code-review, security]
dependencies: []
---

# NEO4J_PASSWORD Defaults to "tiburcio" — Known-Default-Credential Risk

## Problem Statement

`graph/client.ts` has `env.NEO4J_PASSWORD ?? "tiburcio"` as a fallback. If `NEO4J_PASSWORD` is unset when NEO4J_URI is configured, the driver connects with a well-known default password. Neo4j community edition does not enforce password changes on first boot.

## Findings

**File:** `backend/src/graph/client.ts:22`
```typescript
neo4j.auth.basic("neo4j", env.NEO4J_PASSWORD ?? "tiburcio"),
```

The docker-compose plan also wires `NEO4J_AUTH: neo4j/${NEO4J_PASSWORD:-tiburcio}`.

## Proposed Solutions

### Require NEO4J_PASSWORD when NEO4J_URI is set (Recommended)
Add a Zod `.refine()` to `envSchema` mirroring the existing `INFERENCE_BASE_URL`/`INFERENCE_MODEL` refinement pattern:
```typescript
.refine(
  (data) => !data.NEO4J_URI || (data.NEO4J_PASSWORD != null && data.NEO4J_PASSWORD.length > 0),
  { message: "NEO4J_PASSWORD is required when NEO4J_URI is set", path: ["NEO4J_PASSWORD"] }
)
```
Remove the `?? "tiburcio"` fallback from `graph/client.ts`.

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] `?? "tiburcio"` removed from `graph/client.ts`
- [ ] Zod refinement requires `NEO4J_PASSWORD` when `NEO4J_URI` is set
- [ ] `.env.example` documents `NEO4J_PASSWORD` as required when enabling graph

## Work Log

- 2026-03-06: Found by security-sentinel review agent
