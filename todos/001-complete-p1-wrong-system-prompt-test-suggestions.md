---
status: complete
priority: p1
issue_id: "001"
tags: [code-review, bug, architecture]
dependencies: []
---

# Wrong System Prompt Used for Test Suggestion Generation

## Problem Statement

`CODE_REVIEW_SYSTEM_PROMPT` is used as the `system` prompt when generating test suggestions in the nightly pipeline. This prompt instructs the model to output a JSON array of review notes with `severity`, `category`, `filePath`, `text` fields — but the user prompt asks for "ONLY a test scaffold." The model receives contradictory instructions and produces either malformed JSON or confused mixed output stored in the `test-suggestions` Qdrant collection.

## Findings

**File:** `backend/src/mastra/workflows/nightly-review.ts:410`

```typescript
const { text } = await generateText({
  model: getChatModel(),
  system: CODE_REVIEW_SYSTEM_PROMPT,   // BUG: this is the code review prompt
  messages: [{ role: "user", content: prompt }],
  abortSignal: AbortSignal.timeout(120_000),
});
```

The user prompt (lines 397-405) says "Respond with ONLY a test scaffold — the actual test code a developer would use." The system prompt says to output JSON review notes. These are mutually exclusive instructions.

## Proposed Solutions

### Option A: Create a dedicated TEST_SUGGESTION_SYSTEM_PROMPT (Recommended)
Add a `TEST_SUGGESTION_SYSTEM_PROMPT` constant alongside `CODE_REVIEW_SYSTEM_PROMPT` in `nightly-review.ts`. Replace line 410.

**Pros:** Correct, minimal change, clear intent
**Effort:** Small
**Risk:** Low

### Option B: Remove the system prompt entirely
Pass no `system:` field — the user message already has full context.

**Pros:** Even simpler, avoids drift
**Effort:** Small
**Risk:** Low (model still has user message guidance)

## Recommended Action

Option A — add a small focused system prompt. Something like:
```
"You are a test scaffold generator. Output only executable test code — no explanation, no JSON, no markdown. Use Vitest for TypeScript/Vue, JUnit for Java."
```

## Technical Details

- **Affected files:** `backend/src/mastra/workflows/nightly-review.ts`
- **Affected collection:** `test-suggestions` in Qdrant (all existing data may be malformed)

## Acceptance Criteria

- [ ] `generateText` call for test suggestions uses a system prompt that does NOT reference JSON output
- [ ] Generated test scaffold text is valid code, not JSON review notes
- [ ] Existing malformed test-suggestions collection can be cleared and regenerated

## Work Log

- 2026-03-06: Found by architecture-strategist + performance-oracle review agents
