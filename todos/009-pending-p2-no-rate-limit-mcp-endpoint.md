---
status: complete
priority: p2
issue_id: "009"
tags: [code-review, security, performance]
dependencies: ["004"]
---

# No Rate Limiting on MCP HTTP Endpoint

## Problem Statement

The MCP router is mounted at `/mcp` outside the `/api/*` global rate limiter chain (`server.ts:80`). An authenticated MCP client can issue unlimited tool calls with no throttling — triggering unlimited Qdrant searches and LLM API calls. Combined with the timing-unsafe auth check (todo #004), a brute-forcing attacker also gets unlimited attempts with no lockout.

## Findings

**File:** `backend/src/server.ts:66,80`
```typescript
app.use("/api/*", globalLimiter);   // rate limiting on /api/*
app.route("/mcp", mcpRouter);       // NO rate limiting
```

**File:** `backend/src/routes/mcp.ts:250-263`
The auth middleware applies only auth — no rate limiting of any kind.

## Proposed Solutions

### Option A: Apply rate limiter inside mcpRouter (Recommended)
After the auth middleware in `routes/mcp.ts`, add a rate limiter keyed by the API key (or IP):

```typescript
// After auth check:
mcpRouter.use("/*", mcpRateLimiter);
```

Add `mcpRateLimiter` to `middleware/rate-limiter.ts` — e.g., 300 req/min per client.

**Pros:** Contained to MCP router, doesn't affect other routes, generous limit still protects LLM budget
**Effort:** Small
**Risk:** Low

### Option B: Move MCP router under /api/* prefix
Brings it under the global limiter automatically but changes the URL scheme.

**Pros:** Reuses existing limiter
**Cons:** Breaking change for existing Claude Code MCP configurations (`/mcp/sse` → `/api/mcp/sse`)
**Verdict:** Not recommended — too disruptive

## Technical Details

- **Affected files:** `backend/src/routes/mcp.ts`, `backend/src/middleware/rate-limiter.ts`

## Acceptance Criteria

- [ ] MCP endpoint has its own rate limiter (separate from /api/* limiter)
- [ ] Rate limit is configurable or at minimum 200-500 req/min per authenticated client
- [ ] Excessive requests receive 429 response

## Work Log

- 2026-03-06: Found by security-sentinel review agent
