---
status: complete
priority: p3
issue_id: "016"
tags: [code-review, quality, consistency]
dependencies: []
---

# Zod v3/v4 Mixed Across Codebase — Normalize to v3

## Problem Statement

The codebase uses both `import { z } from "zod"` (v3) and `import { z } from "zod/v4"` across different files. CLAUDE.md explicitly requires v3: *"Import z from 'zod' (v3), not 'zod/v4' — AI SDK v6's FlexibleSchema requires Zod v3 types."* Having both loaded simultaneously is a maintenance timebomb.

## Findings

Files using `"zod/v4"`:
- `backend/src/mcp.ts:6`
- `backend/src/routes/mcp.ts:13`
- `backend/src/config/env.ts:5`
- `backend/src/routes/auth.ts:9`
- `backend/src/routes/chat.ts:8`

Files using `"zod"` (v3): All 10 tool files in `mastra/tools/`

The AI SDK constraint (v3 required) only applies to tool `inputSchema` objects. The MCP, env, auth, and chat files don't use AI SDK directly — they could theoretically use v4. However, consistency wins: pick v3 for everything and remove the confusion.

## Proposed Solutions

### Normalize all imports to `"zod"` (v3) (Recommended)
Simple find-and-replace of `from "zod/v4"` → `from "zod"` across the 5 affected files. No behavior change since both versions support the same API surface used here.

**Effort:** Small (5 line changes) | **Risk:** Low

## Acceptance Criteria

- [ ] Zero `import { z } from "zod/v4"` in the backend source tree
- [ ] All Zod imports use `"zod"` (v3)
- [ ] `pnpm check` passes after change

## Work Log

- 2026-03-06: Found by TypeScript reviewer + architecture-strategist + simplicity reviewer agents
