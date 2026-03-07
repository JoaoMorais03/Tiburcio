---
status: complete
priority: p1
issue_id: "005"
tags: [code-review, architecture, quality]
dependencies: []
---

# `infra.ts` Exports chatModel/embeddingModel — Contradicts CLAUDE.md + Causes Dual Instantiation

## Problem Statement

`infra.ts` exports `chatModel` and `embeddingModel` singletons created at module load time. CLAUDE.md explicitly states: *"mastra/infra.ts — rawQdrant + ensureCollection (no chatModel/embeddingModel — use lib/model-provider.ts)"*.

Worse: `nightly-review.ts` imports `getChatModel()` directly from `lib/model-provider.ts` (line 30), bypassing `infra.ts`. This creates TWO separate model instances on startup — one unused in `infra.ts`, one in `nightly-review.ts`. The documented single source of truth is violated.

## Findings

**File:** `backend/src/mastra/infra.ts:17-21`
```typescript
export const chatModel = getChatModel();
export const embeddingModel = getEmbeddingModel();
```

**File:** `backend/src/mastra/workflows/nightly-review.ts:30`
```typescript
import { getChatModel } from "../../lib/model-provider.js";
```

**File:** `backend/src/indexer/embed.ts:7` — imports `embeddingModel` from `infra.ts`
**File:** `backend/src/indexer/contextualize.ts:10` — imports `chatModel` from `infra.ts`

The CLAUDE.md comment on `infra.ts` reads "Single source of truth for Qdrant client, LLM models, and embedding models" — directly contradicting the CLAUDE.md architecture docs.

## Proposed Solutions

### Option A: Remove chatModel/embeddingModel from infra.ts (Recommended)
- Delete lines 17-21 from `infra.ts`
- Update `embed.ts` to call `getEmbeddingModel()` directly from `lib/model-provider.js`
- Update `contextualize.ts` to call `getChatModel()` directly
- Update CLAUDE.md `infra.ts` comment to match reality
- Update tests: mock `model-provider.js` instead of `infra.js` for model stubs

**Pros:** Matches CLAUDE.md intent, eliminates duplicate instances, makes testing cleaner
**Effort:** Small
**Risk:** Low (mechanical change)

### Option B: Keep in infra.ts, update nightly-review.ts to import from infra.ts
**Pros:** Single instance
**Cons:** Contradicts CLAUDE.md philosophy, all callers coupled to infra.ts side-effects
**Verdict:** Not recommended

## Technical Details

- **Affected files:** `backend/src/mastra/infra.ts`, `backend/src/indexer/embed.ts`, `backend/src/indexer/contextualize.ts`, `backend/src/mastra/workflows/nightly-review.ts`
- **Test impact:** Tests mocking `"../mastra/infra.js"` with `{ chatModel: {}, embeddingModel: {} }` need to shift to mocking `"../lib/model-provider.js"`

## Acceptance Criteria

- [ ] `infra.ts` exports only: `rawQdrant`, `listCollections`, `deleteCollection`, `ensureCollection`
- [ ] `embed.ts` and `contextualize.ts` import from `lib/model-provider.js` directly
- [ ] CLAUDE.md `infra.ts` comment reflects the actual exports
- [ ] All tests pass after mock update

## Work Log

- 2026-03-06: Found by TypeScript reviewer + architecture-strategist + simplicity reviewer agents
