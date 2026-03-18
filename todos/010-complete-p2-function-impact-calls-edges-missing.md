---
status: complete
priority: p2
issue_id: "010"
tags: [code-review, architecture, bug]
dependencies: []
---

# getImpactAnalysis with targetType="function" Always Returns Empty (CALLS Edges Never Built)

## Problem Statement

`getImpactAnalysis` supports `targetType: "function"` which queries `CALLS` edges in Neo4j. However, `graph/extractor.ts` never creates any `CALLS` edges — it only creates `IMPORTS`, `EXTENDS`, and `QUERIES` edges. The tool silently returns "No dependents found" for every function query even when the graph is fully populated. This is a broken feature with no error indication.

## Findings

**File:** `backend/src/mastra/tools/get-impact-analysis.ts:26-31`
```typescript
function: `
  MATCH path = (caller)-[:CALLS*1..$depth]->(target:Function {name: $target})
  RETURN ...
`,
```

**File:** `backend/src/graph/extractor.ts` — grep for `CALLS` shows zero matches. The extractor creates `IMPORTS`, `EXTENDS`, and `QUERIES` edge types only.

`getImpactAnalysis` with `targetType: "function"` will always return `dependents: []` and `summary: "No dependents found... or the graph has not been built yet."` — but the graph IS built, just doesn't have CALLS edges.

## Proposed Solutions

### Option A: Remove "function" from CYPHER_BY_TYPE with a clear error (Recommended — honest)
```typescript
function: null, // Not yet implemented — CALLS edge extraction not supported
```
Return `{ available: false, message: "Function-level impact analysis is not yet supported. Use targetType: 'file' or 'class' instead." }`

**Pros:** Honest to users, no silent empty results, can be implemented later
**Effort:** Small
**Risk:** Low

### Option B: Implement CALLS edge extraction in graph/extractor.ts
Parse function call sites from TypeScript/Java AST and write `CALLS` edges to Neo4j.

**Pros:** Feature complete
**Cons:** Significantly more complex — requires call-site tracking, not just declaration extraction
**Effort:** Large
**Risk:** Medium

## Technical Details

- **Affected files:** `backend/src/mastra/tools/get-impact-analysis.ts`, `backend/src/graph/extractor.ts`
- **Note:** `file`, `class`, and `table` targetTypes work correctly. Only `function` is broken.

## Acceptance Criteria

- [ ] `getImpactAnalysis` with `targetType: "function"` either works correctly or returns a clear "not yet implemented" message
- [ ] No silent empty results that look like "graph not built"

## Work Log

- 2026-03-06: Found by architecture-strategist review agent
