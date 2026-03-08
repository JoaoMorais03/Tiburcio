---
status: complete
priority: p2
issue_id: "021"
tags: [code-review, docs, version]
---

# Version needs bumping from 2.1.0 to 2.2.0

## Problem Statement

This branch adds significant features (Langfuse observability, MCP compact mode improvements, on-demand nightly, Neo4j wiring) but the version is still 2.1.0 across all files. Per CLAUDE.md: "v2.1.0 — consistent across backend/package.json, frontend/package.json, backend/src/server.ts, backend/src/mcp.ts."

## Findings

- `backend/package.json`: still "2.1.0"
- `frontend/package.json`: still "2.1.0"
- `backend/src/server.ts`: still "2.1.0" (in startup log)
- `backend/src/mcp.ts:10`: still `version: "2.1.0"`
- CLAUDE.md Version section: still "v2.1.0"

## Proposed Solutions

**Option A: Bump to v2.2.0**
Minor version bump — new features, no breaking changes to the MCP tool schema (only output format changed).

- Effort: Small
- Risk: None

## Acceptance Criteria

- [ ] All 4 version locations updated to 2.2.0
- [ ] CLAUDE.md version section updated
- [ ] CHANGELOG updated with 2.2.0 entry
