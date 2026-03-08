---
status: complete
priority: p3
issue_id: "022"
tags: [code-review, langfuse, reliability]
---

# Langfuse trace errors not caught in embed.ts and nightly-review.ts

## Problem Statement

In `langfuse.ts`, `traceToolCall()` properly catches errors and still re-throws. But in `embed.ts` and `nightly-review.ts`, the Langfuse `generation?.end()` and `trace?.update()` calls are not wrapped in try/catch. If the Langfuse SDK throws (e.g., serialization error on large output), it would crash the embedding or nightly pipeline.

## Findings

- `embed.ts:58`: `generation?.end()` not in try/catch
- `embed.ts:75`: `generation?.end()` not in try/catch
- `nightly-review.ts:302-305`: `langfuse?.trace()` not in try/catch
- `langfuse.ts:67-92`: `traceToolCall()` correctly catches — good pattern to follow

The Langfuse SDK is generally fire-and-forget, so this is low risk. But the principle of "observability should never break the thing it observes" applies.

## Proposed Solutions

**Option A: Wrap all Langfuse calls in try/catch**
Add try/catch around every `generation?.end()` and `trace?.update()` call.

- Effort: Small
- Risk: None

**Option B: Accept the risk**
The Langfuse SDK is designed to not throw. Optional chaining (`?.`) handles null. Only a Langfuse SDK bug would cause issues.

- Effort: None
- Risk: Very low

## Acceptance Criteria

- [ ] No Langfuse call can crash a business-critical code path
