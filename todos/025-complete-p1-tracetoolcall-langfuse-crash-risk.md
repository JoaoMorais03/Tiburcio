---
status: complete
priority: p1
issue_id: "025"
tags: [code-review, security, langfuse, mcp]
dependencies: []
---

# traceToolCall Langfuse calls can crash all 10 MCP tools

## Problem Statement

In `lib/langfuse.ts:78-79`, the `span.end()` and `trace.update()` calls inside `traceToolCall()` are NOT wrapped in try/catch. If Langfuse's API throws (network error, malformed result), it propagates up and crashes the MCP tool call. This affects ALL 10 tools because `traceToolCall` wraps every tool registration in `mcp-tools.ts`.

The codebase already follows the "observability must never crash" principle in `embed.ts`, `nightly-review.ts`, and `chat.ts` — but missed applying it to `traceToolCall` itself, which is the most critical location.

Additionally, `result as Record<string, unknown>` on line 78 is an unsafe cast — `T` can be any type (string, array, etc.), and Langfuse may throw if it receives a non-object.

## Findings

- **Source**: TypeScript reviewer (Critical #1, #2)
- **Evidence**: `backend/src/lib/langfuse.ts:78-79` — unguarded Langfuse calls
- **Impact**: Latent crash risk for ALL MCP tools when Langfuse is configured AND a Langfuse API call fails

## Proposed Solutions

### Option A: Wrap span.end() and trace.update() in try/catch (Recommended)
```typescript
try {
  span.end(recordIO ? { output: { data: result } } : {});
  trace.update({ output: recordIO ? { data: result } : undefined });
} catch { /* observability must never crash tools */ }
```
- **Effort**: Small (5 lines)
- **Risk**: None
- **Pros**: Consistent with pattern used everywhere else

### Option B: Wrap entire post-fn() block
- **Effort**: Small
- **Risk**: None
- **Pros**: Catches any future Langfuse additions too

## Acceptance Criteria

- [ ] `span.end()` and `trace.update()` wrapped in try/catch in `traceToolCall`
- [ ] `result` wrapped in `{ data: result }` instead of cast to `Record<string, unknown>`
- [ ] Existing tests still pass
