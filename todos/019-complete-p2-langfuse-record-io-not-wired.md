---
status: complete
priority: p2
issue_id: "019"
tags: [code-review, langfuse, quality]
---

# LANGFUSE_RECORD_IO env var is declared but not actually used

## Problem Statement

`env.ts` declares `LANGFUSE_RECORD_IO` and `langfuse.ts` reads it, but the actual Langfuse SDK doesn't have a global `recordInputs`/`recordOutputs` config option on the `Langfuse` constructor. The `!recordIO` branch in `langfuse.ts` only sets up an error handler — it doesn't actually disable I/O recording.

The code at `langfuse.ts:27` (`...(!recordIO && { defaultPromptCacheOptions: undefined })`) is a no-op spread that does nothing.

## Findings

- `langfuse.ts:21-28`: `LANGFUSE_RECORD_IO` is read but the Langfuse constructor spread is meaningless
- To actually disable I/O recording, each `trace()`, `generation()`, and `span()` call needs to omit `input`/`output` fields when `recordIO` is false
- Currently all `traceToolCall()` calls pass full `input` and `output` regardless

## Proposed Solutions

**Option A: Wire recordIO into traceToolCall and all trace sites**
In `traceToolCall()`, check `env.LANGFUSE_RECORD_IO !== "false"` before passing `input`/`output` to trace/span. Same for `embed.ts` and `nightly-review.ts` generation spans.

- Effort: Small
- Risk: Low

**Option B: Remove the env var until needed**
Delete `LANGFUSE_RECORD_IO` from env.ts and the dead code from langfuse.ts. Add it back properly when someone actually needs privacy mode.

- Effort: Small
- Risk: Low

## Acceptance Criteria

- [ ] When `LANGFUSE_RECORD_IO=false`, no input/output data appears in Langfuse traces
- [ ] When `LANGFUSE_RECORD_IO=true` (default), full input/output is recorded
