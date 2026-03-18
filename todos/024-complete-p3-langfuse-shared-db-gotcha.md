---
status: complete
priority: p3
issue_id: "024"
tags: [code-review, docker, docs]
---

# Langfuse separate database not documented

## Problem Statement

We discovered that Langfuse cannot share PostgreSQL with Tiburcio (Prisma migration error P3005). The fix (separate `langfuse` database) was applied to docker-compose.yml but not documented anywhere. A developer setting up fresh will hit the same error if they manually create a shared DB.

## Findings

- `docker-compose.yml:63`: Langfuse now points to `langfuse` database instead of `${POSTGRES_DB}`
- No documentation mentions this requirement
- The `langfuse` database was created manually via `docker exec ... CREATE DATABASE langfuse`
- On fresh `docker compose up`, PostgreSQL auto-creates the DB from the connection string... but only if it doesn't exist

## Proposed Solutions

**Option A: Document in README + add init script**
Add a note in the Observability section explaining the separate DB. Add a PostgreSQL init script (`docker-entrypoint-initdb.d/`) that creates both databases on first boot.

- Effort: Small
- Risk: None

## Acceptance Criteria

- [ ] Fresh `docker compose --profile observability up -d` works without manual DB creation
- [ ] README documents the separate database requirement
