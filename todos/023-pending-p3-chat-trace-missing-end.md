---
status: pending
priority: p3
issue_id: "023"
tags: [code-review, langfuse, quality]
---

# Chat trace created but never ended/updated with output

## Problem Statement

In `chat.ts:113-119`, a Langfuse trace is created for `chat:stream` but never updated with the final output or ended. The trace will show as "started" forever in the Langfuse dashboard — no completion status, no output, no token usage.

## Findings

- `chat.ts:114`: `langfuse?.trace()` is created with input
- The `streamText()` result streams via SSE — the trace is never updated with the response
- Compare with `traceToolCall()` in `langfuse.ts:80-81` which properly calls `span.end()` and `trace.update()`

## Proposed Solutions

**Option A: Update trace after stream completes**
After the SSE stream finishes, update the trace with the accumulated response text and token count.

- Effort: Medium (need to hook into stream completion)
- Risk: Low

**Option B: Accept as-is for now**
The trace still records that a chat happened, with the user's input. Output recording for streaming is complex and can be added later.

- Effort: None
- Risk: Low (incomplete data in Langfuse, but not broken)

## Acceptance Criteria

- [ ] Chat traces in Langfuse show completion status
