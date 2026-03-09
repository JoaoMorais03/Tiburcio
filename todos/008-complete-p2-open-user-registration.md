---
status: complete
priority: p2
issue_id: "008"
tags: [code-review, security]
dependencies: []
---

# Open User Registration — No Invite or Admin Gating

## Problem Statement

`/api/auth/register` allows any unauthenticated caller to create an account. There is no invite token, admin approval, or feature flag. A registered account gains full access to the chat interface, all RAG tools, and indexed codebase intelligence. For an internal developer intelligence tool, this is an access control gap.

## Findings

**File:** `backend/src/routes/auth.ts:67-90`

Auth rate limiter (10 req/15 min per IP) slows but doesn't prevent account farming from multiple IPs. The `isAdmin` flag in the schema is never settable via any public API (correct), but ordinary account access itself is unrestricted.

## Proposed Solutions

### Option A: DISABLE_REGISTRATION env flag (Recommended — simplest)
Add `DISABLE_REGISTRATION: z.boolean().default(false)` to env schema. When `true`, the `/register` endpoint returns 403. Teams create initial accounts with the flag disabled, then enable it.

```typescript
if (env.DISABLE_REGISTRATION) {
  return c.json({ error: "Registration is disabled" }, 403);
}
```

**Pros:** Zero complexity, easy to toggle, matches the tool's use case (internal team)
**Effort:** Small
**Risk:** Low

### Option B: REGISTRATION_INVITE_CODE
Add a required `inviteCode` field to the register body, checked against an env var.

**Pros:** Self-service onboarding without admin involvement
**Cons:** Invite code must be managed and rotated
**Effort:** Small

### Option C: Admin-only registration
Require an active admin JWT cookie to call `/register`. Converts registration to a user management API.

**Pros:** Proper RBAC
**Cons:** Needs admin UI/CLI
**Effort:** Medium

## Technical Details

- **Affected files:** `backend/src/routes/auth.ts`, `backend/src/config/env.ts`
- **Note:** Document the chosen approach in README.md under configuration

## Acceptance Criteria

- [ ] `/api/auth/register` cannot be called by arbitrary strangers in production
- [ ] Chosen mechanism is documented in README.md and `.env.example`

## Work Log

- 2026-03-06: Found by security-sentinel review agent
