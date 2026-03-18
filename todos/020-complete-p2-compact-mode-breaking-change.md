---
status: complete
priority: p2
issue_id: "020"
tags: [code-review, architecture, breaking-change]
---

# searchCode compact mode output changed (breaking API change)

## Problem Statement

The `mapPointToCompact()` function in `search-code.ts` replaced the `summary` field with `codePreview`. Any downstream consumer expecting `summary` in the response will break. This includes the chat UI's `searchCodeTool` and any Claude Code prompts that reference `summary` in tool outputs.

## Findings

- `search-code.ts:29`: `summary` field removed, replaced with `codePreview`
- The `searchCodeTool` (AI SDK tool export) calls the same `executeSearchCode()`, so the chat UI is also affected
- CLAUDE.md says "Compact Mode: 300-1,500 tokens per call (3 results, summaries)" — now outdated
- Existing tests use `compact: false` so they didn't catch this

## Proposed Solutions

**Option A: Keep both fields during transition**
Return both `summary` (deprecated) and `codePreview` for one version, then drop `summary` in the next.

- Effort: Small
- Risk: Low (backward compatible)

**Option B: Just ship codePreview (current approach)**
Accept the breaking change since this is pre-1.0 API stability. Update CLAUDE.md to document `codePreview` instead of summaries.

- Effort: Small
- Risk: Low (no external consumers yet)

## Acceptance Criteria

- [ ] CLAUDE.md updated to mention `codePreview` instead of summaries
- [ ] Add a compact mode test to verify the new output format
