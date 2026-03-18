---
status: complete
priority: p1
issue_id: "004"
tags: [code-review, security]
dependencies: []
---

# TEAM_API_KEY Comparison Is Timing-Unsafe (Timing Attack on MCP Bearer Auth)

## Problem Statement

The MCP HTTP/SSE endpoint compares Bearer tokens using JavaScript's `!==` operator, which short-circuits on the first differing byte. An attacker can measure response time differences to recover the `TEAM_API_KEY` byte-by-byte (timing oracle). This is especially dangerous because the MCP endpoint sits outside the global rate limiter and has no brute-force protection.

## Findings

**File:** `backend/src/routes/mcp.ts:259`
```typescript
if (authHeader.slice(7) !== env.TEAM_API_KEY) {
  return c.json({ error: "Unauthorized" }, 401);
}
```

- MCP endpoint mounted at `/mcp` (outside `/api/*` rate limiter chain — `server.ts:80`)
- No rate limiting on MCP auth attempts (confirmed in P2-3 todo)
- `timingSafeEqual` / `crypto.timingSafe` has zero matches across entire `src/` tree

## Proposed Solutions

### Option A: Use `crypto.timingSafeEqual` (Recommended)
```typescript
import { timingSafeEqual } from "node:crypto";

const provided = Buffer.from(authHeader.slice(7));
const expected = Buffer.from(env.TEAM_API_KEY);
if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
  return c.json({ error: "Unauthorized" }, 401);
}
```

**Pros:** Eliminates timing oracle, Node.js built-in (no new dep), minimal change
**Effort:** Small
**Risk:** Low

## Technical Details

- **Affected file:** `backend/src/routes/mcp.ts`
- **Note:** Length check must happen before `timingSafeEqual` (different lengths can be checked in constant time by always calling `timingSafeEqual` on same-length buffers, or by a simple boolean short-circuit that leaks only length — acceptable tradeoff for API keys of uniform length)

## Acceptance Criteria

- [ ] `authHeader.slice(7) !== env.TEAM_API_KEY` replaced with `timingSafeEqual`
- [ ] `import { timingSafeEqual } from "node:crypto"` added
- [ ] Both length mismatch and content mismatch return 401

## Work Log

- 2026-03-06: Found by security-sentinel review agent
