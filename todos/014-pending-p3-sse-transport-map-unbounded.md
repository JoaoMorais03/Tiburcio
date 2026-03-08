---
status: complete
priority: p3
issue_id: "014"
tags: [code-review, security, performance]
dependencies: []
---

# SSE Transport Map Is Unbounded — Potential Memory Leak on Dropped Connections

## Problem Statement

`activeTransports` in `routes/mcp.ts` is a module-level `Map<string, SSEServerTransport>` cleaned up via the `close` event on `ServerResponse`. If a connection is dropped abnormally (TCP RST, proxy timeout), the `close` event may not fire reliably. Transports accumulate indefinitely, growing heap usage with no bound.

## Findings

**File:** `backend/src/routes/mcp.ts:247,270,275-277`
```typescript
const activeTransports = new Map<string, SSEServerTransport>();
activeTransports.set(sessionId, transport);
res.on("close", () => { activeTransports.delete(sessionId); });
```

No TTL, no max-size, no periodic cleanup.

## Proposed Solutions

### TTL-based eviction via setInterval (Recommended)
Store creation timestamps alongside transports:
```typescript
const activeTransports = new Map<string, { transport: SSEServerTransport; createdAt: number }>();
```
Add a cleanup interval (every 60s) that removes entries older than 30 minutes.

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] Stale/abandoned transport entries are evicted from the map
- [ ] Cleanup interval does not interfere with active connections

## Work Log

- 2026-03-06: Found by security-sentinel review agent
