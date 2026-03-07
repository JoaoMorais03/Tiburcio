---
status: complete
priority: p1
issue_id: "003"
tags: [code-review, architecture, quality, dry]
dependencies: []
---

# MCP Tool Registration Duplicated Across Two Files (200+ Lines)

## Problem Statement

All 10 MCP tools are registered twice: once in `src/mcp.ts` (stdio transport) and once inside `createMcpServer()` in `src/routes/mcp.ts` (HTTP/SSE transport). This is ~220 lines of near-identical boilerplate that has already drifted — the tool descriptions are different between the two files. This violates the project's core principle: "Single source of truth — one place for each concern."

## Findings

**Files:** `backend/src/mcp.ts:21-249` and `backend/src/routes/mcp.ts:32-244`

Description drift already present:
- `searchStandards`: stdio has 4 sentences with cross-tool navigation hints; HTTP has 2 truncated sentences
- `getArchitecture`: stdio includes "Use when asked how components connect, data flows..."; HTTP has no usage guidance at all
- `searchReviews`: HTTP description is 1 sentence vs 3 in stdio

Claude Code uses tool descriptions to choose which tool to call. Worse descriptions in HTTP transport = worse tool selection for team deployments.

## Proposed Solutions

### Option A: Shared `registerTools(server)` function (Recommended)
Create `backend/src/mcp-tools.ts` with a single exported function:
```typescript
export function registerTools(server: McpServer): void {
  server.registerTool("searchStandards", { ... }, async (...) => { ... });
  // ... all 10 tools
}
```
Both `mcp.ts` and `routes/mcp.ts` import and call `registerTools(server)`.

**Pros:** Single source of truth, eliminates drift, ~200 LOC reduction, descriptions maintained once
**Effort:** Medium (mechanical refactor)
**Risk:** Low

### Option B: Keep both but add a lint rule to catch drift
No — this doesn't fix the root cause.

## Technical Details

- **Affected files:** `backend/src/mcp.ts`, `backend/src/routes/mcp.ts`
- **New file:** `backend/src/mcp-tools.ts` (or `backend/src/mastra/tools/registry.ts`)
- **Note:** The `routes/mcp.ts` wraps everything in `createMcpServer()` called per SSE connection — that factory pattern stays, just calls `registerTools(server)` internally.

## Acceptance Criteria

- [ ] Tool registration code exists in exactly one place
- [ ] Both `mcp.ts` and `routes/mcp.ts` call a shared `registerTools()` function
- [ ] All 10 tool descriptions are identical between stdio and HTTP transports
- [ ] Tests still pass (`pnpm test` in backend/)

## Work Log

- 2026-03-06: Found by TypeScript reviewer + architecture-strategist review agents
