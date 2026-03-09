---
status: complete
priority: p2
issue_id: "027"
tags: [code-review, consistency, mcp]
dependencies: []
---

# MCP server version mismatch between stdio and HTTP/SSE transports

## Problem Statement

`mcp.ts` declares `version: "2.2.0"` (line 10) but `routes/mcp.ts` declares `version: "2.1.0"` (line 22). An agent querying MCP server metadata sees different versions depending on the transport.

## Findings

- **Source**: Agent-native reviewer
- **Evidence**: `backend/src/mcp.ts:10` vs `backend/src/routes/mcp.ts:22`

## Proposed Solutions

### Option A: Fix `routes/mcp.ts` to "2.2.0" (Recommended)
- **Effort**: Trivial (1 line)

### Option B: Import version from `package.json` — single source of truth
- **Effort**: Small
- **Pros**: Never drifts again

## Acceptance Criteria

- [ ] Both MCP transports report the same version
