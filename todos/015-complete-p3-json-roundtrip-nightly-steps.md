---
status: complete
priority: p3
issue_id: "015"
tags: [code-review, performance, quality]
dependencies: []
---

# JSON Round-Trip Between Nightly Pipeline Steps — Mastra Remnant

## Problem Statement

`nightly-review.ts` serializes commits to JSON at the end of `codeReview` step (`commitsJson: JSON.stringify(allCommits)`) then immediately `JSON.parse`s it in `generateTestSuggestions`. These are same-process function calls. The serialization is a leftover from Mastra's workflow step-boundary design (steps communicated via serializable payloads) that was not cleaned up when Mastra was removed.

## Findings

**File:** `backend/src/mastra/workflows/nightly-review.ts:351,363`
```typescript
// codeReview returns:
return { ..., commitsJson: JSON.stringify(allCommits) };
// generateTestSuggestions receives:
const commits = JSON.parse(commitsJson) as CommitInfo[];
```

Also note: `enrichChunkForEmbedding` is called twice per chunk in the nightly reindex path — once for the `textsToEmbed` array and again inside the `contentHash` computation. Pre-computing the strings once would eliminate the redundant calls.

## Proposed Solutions

### Pass typed array directly (Recommended)
Change the return type of `codeReview` to pass `commits: CommitInfo[]` directly. Remove `JSON.stringify`/`JSON.parse`. For `enrichChunkForEmbedding` double-call, pre-compute `const enrichedTexts = chunks.map(...)` and reuse.

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] No `JSON.stringify`/`JSON.parse` for data passed between same-process functions in nightly-review.ts
- [ ] `enrichChunkForEmbedding` called once per chunk in the nightly reindex path

## Work Log

- 2026-03-06: Found by performance-oracle + architecture-strategist review agents
