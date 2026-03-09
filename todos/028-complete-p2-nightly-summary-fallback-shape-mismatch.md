---
status: complete
priority: p2
issue_id: "028"
tags: [code-review, agent-native, mcp]
dependencies: []
---

# getNightlySummary fallback returns different response shape than normal path

## Problem Statement

Normal path returns: `{ summary, severityCounts, criticalItems, warningFiles, testGaps }`
Fallback path returns: `{ source, notice, summary, recentCommits, testGaps }`

Claude Code would try to read `severityCounts` or `criticalItems` from the fallback and get undefined. The `source` and `notice` fields are additive (good), but the missing/renamed fields break agent parsing.

The other 3 fallback tools (`searchReviews`, `getTestSuggestions`, `getChangeSummary`) have better shape consistency.

## Findings

- **Source**: Agent-native reviewer (Q2 analysis)

## Proposed Solutions

### Option A: Match the normal shape with zero/empty values (Recommended)
```typescript
return {
  source: "git-log",
  notice: FALLBACK_NOTICE,
  summary: "...",
  severityCounts: { info: commits.length, warning: 0, critical: 0 },
  criticalItems: [],
  warningFiles: [],
  testGaps: testFiles,
  recentCommits: commits, // extra field, additive
};
```
- **Effort**: Small
- **Risk**: None

## Acceptance Criteria

- [ ] Fallback response includes all fields from normal response (can be empty/zero)
- [ ] Additive fields (`source`, `notice`, `recentCommits`) are fine to keep
