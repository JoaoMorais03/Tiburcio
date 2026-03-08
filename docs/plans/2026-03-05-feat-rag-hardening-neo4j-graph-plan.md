---
title: "feat: RAG Hardening + Neo4j Graph Layer (Changes 2 & 3)"
type: feat
status: active
date: 2026-03-05
---

# RAG Hardening + Neo4j Graph Layer (Changes 2 & 3)

## Overview

Two self-contained changes that build on the completed Mastra removal (Change 1):

- **Change 2 — RAG Hardening**: 4 sub-changes that improve embedding quality and search precision entirely at index-time. Zero query-time overhead.
- **Change 3 — Neo4j Graph Layer**: A thin, optional dependency graph for impact analysis. Nothing breaks when Neo4j is absent.

**Implementation order:** Change 2 first, Change 3 second. They are independent but share the nightly pipeline.

---

## Change 2: RAG Hardening

### Problem Statement

The current RAG pipeline has four known weaknesses:

1. **Sparse embed prefixes** — embed text is built as `` `${chunk.language} ${chunk.layer} ${chunk.filePath}` `` (index-codebase.ts:198). Class name, parent function, and symbol name are discarded from the embedding input, reducing vector quality by ~10%.
2. **No embedding cache** — full reindex always deletes all vectors for the repo then re-embeds every chunk from scratch. For 558 files this costs ~20-50 min and hundreds of LLM embedding calls even when 90% of files haven't changed.
3. **No retrieval quality gate** — all 9 MCP tools return whatever Qdrant returns, including near-zero-score results. Claude hallucinates when given irrelevant context.
4. **Parent-child linking** — already implemented and consistent across both code paths. No action needed (verified below).

### 2C: Parent-Child Chunk Links — Verification (No Code Changes)

Both `index-codebase.ts:169-173` and `nightly-review.ts:166-172` implement identical `headerChunkId` linking logic. Both set `headerChunkId = null` for header chunks and point other chunks to the file's header chunk UUID. This is consistent and complete — no changes required.

---

### 2A: Contextual Chunk Enrichment

**Goal:** Prepend structured metadata to the text that gets embedded (not stored). Improves vector quality 10–12% by giving the embedding model rich context about what a chunk represents.

**Scope:** Code chunks only. Standards, architecture, and schemas are prose documents — their embed text is already the full content. Reviews and test-suggestions are generated text — no structured metadata to extract.

**New function location:** `backend/src/indexer/embed.ts`

```typescript
// indexer/embed.ts — add below toUUID()

import type { CodeChunk } from "./chunker.js";

/**
 * Build enriched embed text for a code chunk.
 * Prepends structured metadata so the embedding model understands
 * what the chunk represents before seeing the code.
 * Returns: "[File: ... | Language: ... | Layer: ... | Symbol: ... | Parent: ...]\n{content}"
 *
 * The ORIGINAL content (not enriched text) is stored in Qdrant payload.
 * Only the enriched text is ever passed to the embedding model.
 */
export function enrichChunkForEmbedding(chunk: CodeChunk, context?: string): string {
  const parts = [
    chunk.filePath && `File: ${chunk.filePath}`,
    chunk.language && `Language: ${chunk.language}`,
    chunk.layer && `Layer: ${chunk.layer}`,
    chunk.symbolName && `Symbol: ${chunk.symbolName}`,
    chunk.parentSymbol && `Parent: ${chunk.parentSymbol}`,
  ].filter(Boolean).join(" | ");

  const prefix = parts ? `[${parts}]` : "";
  const withContext = context ? `${context}\n\n${prefix}` : prefix;
  return withContext ? `${withContext}\n\n${chunk.content}` : chunk.content;
}
```

**Files to update:**

**`backend/src/indexer/index-codebase.ts`** — replace lines 197-201:

```typescript
// Before:
const textsToEmbed = chunks.map((chunk, idx) => {
  const prefix = `${chunk.language} ${chunk.layer} ${chunk.filePath}`;
  return contexts[idx]
    ? `${contexts[idx]}\n\n${prefix}\n\n${chunk.content}`
    : `${prefix}\n\n${chunk.content}`;
});

// After:
const textsToEmbed = chunks.map((chunk, idx) =>
  enrichChunkForEmbedding(chunk, contexts[idx] || undefined),
);
```

**`backend/src/mastra/workflows/nightly-review.ts`** — replace lines 184-188 (same pattern, same fix):

```typescript
// Before:
const textsToEmbed = chunks.map((c, idx) => {
  const prefix = `${c.language} ${c.layer} ${c.filePath}`;
  return contexts[idx]
    ? `${contexts[idx]}\n\n${prefix}\n\n${c.content}`
    : `${prefix}\n\n${c.content}`;
});

// After:
const textsToEmbed = chunks.map((c, idx) =>
  enrichChunkForEmbedding(c, contexts[idx] || undefined),
);
```

**CLAUDE.md note to add:** "Embedding layer separation — `embed.ts` now also exports `enrichChunkForEmbedding()` for code chunk embed-text construction."

---

### 2B: Embedding Cache via Content Hashing

**Goal:** Turn full reindex from O(all chunks) to O(changed chunks). Skip embedding for chunks whose content hasn't changed since the last index.

**Strategy:** Compute SHA-256 of the enriched embed text per chunk. Store `contentHash` in Qdrant payload. Before embedding a batch of chunks, retrieve existing payloads by their deterministic IDs and compare hashes. Skip embedding for matches; only embed new/changed chunks.

**Key constraint:** The current full index deletes all vectors for the repo before processing. This must change — if we delete first, there's nothing to retrieve hashes from.

**New full index strategy (replacing the delete-all approach):**

1. Collect all chunk IDs generated during processing (deterministic — `repo:filePath:startLine`)
2. For each file: retrieve existing payloads by chunk IDs → compare `contentHash` → skip embedding for unchanged chunks, re-upsert with existing stored vectors for them
3. After all files processed: scroll Qdrant to find any IDs for the repo that are NOT in the current set → delete orphans (handles deleted functions, renamed files)

**New export in `backend/src/indexer/embed.ts`:**

```typescript
import { createHash } from "node:crypto";  // already imported for toUUID

/** SHA-256 of the given text, hex-encoded (first 64 chars — 32 bytes, collision-resistant). */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
```

**Qdrant payload shape change (code-chunks collection):**

```typescript
payload: {
  // ... existing fields ...
  contentHash: string;  // NEW: SHA-256 of enriched embed text
  indexedAt: string;    // NEW: ISO timestamp of last index
}
```

**Batch retrieve pattern in `processFile()`:**

```typescript
// After chunking and enrichment, before embedding:
const chunkIds = chunks.map((c) => chunkId(repoName, c.filePath, c.startLine));
const enrichedTexts = chunks.map((c, idx) => enrichChunkForEmbedding(c, contexts[idx]));
const hashes = enrichedTexts.map(contentHash);

// Batch-retrieve existing payloads for this file's chunk IDs
const existing = await rawQdrant.retrieve(COLLECTION, {
  ids: chunkIds,
  with_payload: ["contentHash"],
  with_vector: true,  // need existing vectors to re-upsert unchanged chunks
}).catch(() => []);

const existingMap = new Map(
  existing.map((p) => [String(p.id), p])
);

// Split: unchanged (hash match) vs needs embedding
const toEmbed: number[] = [];
const embeddings: number[][] = new Array(chunks.length);

for (let i = 0; i < chunks.length; i++) {
  const ex = existingMap.get(chunkIds[i]);
  if (ex?.payload?.contentHash === hashes[i] && ex.vector) {
    embeddings[i] = ex.vector as number[];  // reuse existing dense vector
  } else {
    toEmbed.push(i);
  }
}

// Only embed changed/new chunks
if (toEmbed.length > 0) {
  const newEmbeddings = await withRetry(
    () => embedTexts(toEmbed.map((i) => enrichedTexts[i])),
    "Embedding",
    relPath,
  );
  for (let j = 0; j < toEmbed.length; j++) {
    embeddings[toEmbed[j]] = newEmbeddings[j];
  }
}
```

**Note on named vectors (`code-chunks`):** The collection uses named vectors (`dense` + `bm25`). The `with_vector: true` approach returns `{ dense: [...], bm25: {...} }` — you'll need `with_vector: ["dense"]` and the `ex.vectors?.dense` path. Always use `rawQdrant.retrieve()` with the correct named-vector field access.

**Orphan cleanup after full index:**

```typescript
// After all files processed, collect all current chunk IDs:
const allCurrentIds = new Set<string>(/* accumulated during processFile() */);

// Scroll Qdrant to find existing IDs for this repo:
let nextOffset: string | number | null = null;
do {
  const page = await rawQdrant.scroll(COLLECTION, {
    filter: { must: [{ key: "repo", match: { value: repoName } }] },
    limit: 500,
    offset: nextOffset ?? undefined,
    with_payload: false,
    with_vector: false,
  });
  const orphanIds = page.points
    .map((p) => String(p.id))
    .filter((id) => !allCurrentIds.has(id));
  if (orphanIds.length > 0) {
    await rawQdrant.delete(COLLECTION, { wait: true, points: orphanIds });
  }
  nextOffset = page.next_page_offset ?? null;
} while (nextOffset != null);
```

**Important:** Remove the existing delete-by-filter at the start of `indexCodebase()` (lines 278-286 in current code). Orphan cleanup at the end replaces it.

**Apply to nightly incremental path:** The nightly path already limits to git-changed files, so embedding savings are smaller there. Still worth applying for consistency — the same `processFileIncremental()` helper should use hash checking. The existing delete-before-upsert per file in nightly can stay (it's per-file, not per-repo, so it correctly handles chunk count changes within a file). Hash check skips embedding; the upsert still happens to refresh `indexedAt`.

---

### 2D: Retrieval Confidence Threshold

**Goal:** When all results score below a configured threshold, return a clear "low confidence" message rather than returning weak results that cause Claude to hallucinate.

**New env var in `backend/src/config/env.ts`:**

```typescript
// In baseSchema:
RETRIEVAL_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.45),
```

**Tools affected (7):**

| Tool | File | Search type |
|------|------|-------------|
| `searchCode` | `search-code.ts` | `rawQdrant.query()` RRF fusion — uses `points[0].score` |
| `searchStandards` | `search-standards.ts` | `rawQdrant.search()` — uses `results[0].score` |
| `getArchitecture` | `get-architecture.ts` | `rawQdrant.search()` — uses `results[0].score` |
| `searchReviews` | `search-reviews.ts` | `rawQdrant.search()` — uses `results[0].score` |
| `searchSchemas` | `search-schemas.ts` | `rawQdrant.search()` — uses `results[0].score` |
| `getTestSuggestions` | `get-test-suggestions.ts` | `rawQdrant.search()` — uses `results[0].score` |
| `getChangeSummary` | `get-change-summary.ts` | `rawQdrant.search()` — uses `results[0].score` |

**Tools NOT affected:**

- `getPattern` — file-based, no vector search
- `getNightlySummary` — uses a zero-vector scroll (all results, no relevance score)

**Filter pattern** (apply in each tool's execute function after getting results):

```typescript
import { env } from "../../config/env.js";

const threshold = env.RETRIEVAL_CONFIDENCE_THRESHOLD as number;
const topScore = results[0]?.score ?? 0;

if (topScore < threshold) {
  logger.info({ query, topScore, threshold }, "Results below confidence threshold");
  return {
    results: [],
    message:
      `No high-confidence results found (best score: ${topScore.toFixed(3)}, threshold: ${threshold}). ` +
      "Try rephrasing the query or using a different tool.",
  };
}
```

**Note on RRF scores in `search-code.ts`:** Qdrant RRF fusion scores are not cosine similarity — they're rank-fusion scores, typically 0.0–0.1. The default threshold of 0.45 is for cosine similarity tools. For `searchCode` with RRF, either:
- Skip confidence filtering (RRF scores aren't cosine similarity), OR
- Use a separate env var `RETRIEVAL_CODE_SCORE_THRESHOLD` with a lower default (e.g., 0.02)

**Recommended approach:** Add `RETRIEVAL_CODE_SCORE_THRESHOLD: z.coerce.number().default(0.02)` for `searchCode` specifically. The other 6 tools all use plain cosine similarity and share the 0.45 default.

---

## Change 3: Neo4j Graph Layer

### Problem Statement

Vectors find semantically similar code. They cannot traverse dependency chains. "What files will break if I change `PaymentService`?" requires graph traversal — following `IMPORTS`, `CALLS`, and `EXTENDS` edges backwards through the dependency tree. Qdrant cannot do this.

This is an **optional** layer. If `NEO4J_URI` is not set, every graph call returns a graceful "unavailable" message and the rest of Tiburcio operates normally.

### Architecture Decisions

- **4 node types:** `File`, `Function`, `Class`, `Table` — no packages, interfaces, annotations
- **4 edge types:** `IMPORTS`, `CALLS`, `EXTENDS`, `QUERIES` — no return types, parameters, generics
- **70% accuracy is the goal** — wrong edges are worse than missing edges; when ambiguous, skip
- **Extend existing tree-sitter traversal** — do NOT create a parallel parser; graph extraction is a new pass over the same AST walker
- **Full rebuild nightly** — graph is rebuilt after Qdrant indexing; batch UNWIND inserts; target <5s for one monolith
- **Neo4j 5 Community** — free, no clustering, sufficient for a single team's codebase

### System-Wide Impact

- **Nightly pipeline:** `runNightlyReview()` gains a 4th step: `buildGraph()`. If Neo4j is unavailable, this step is skipped silently.
- **Nightly summary enrichment:** When graph is available, `getNightlySummary` adds blast radius text per changed file.
- **New MCP tool:** `getImpactAnalysis` — 10th tool registered in both `mcp.ts` and `routes/mcp.ts`.
- **No Qdrant changes** — graph data lives only in Neo4j. The 6 Qdrant collections are unchanged.
- **No auth changes** — `getImpactAnalysis` uses the same auth as other MCP tools.

---

### New Files

#### `backend/src/graph/client.ts`

```typescript
// graph/client.ts — Neo4j driver with lazy init and graceful degradation.
// If NEO4J_URI is not set, isGraphAvailable() returns false and all graph ops are no-ops.

import neo4j, { type Driver } from "neo4j-driver";
import { env } from "../config/env.js";

let _driver: Driver | null = null;

export function isGraphAvailable(): boolean {
  return !!env.NEO4J_URI;
}

export function getGraphDriver(): Driver {
  if (!isGraphAvailable()) {
    throw new Error("Neo4j not configured. Set NEO4J_URI to enable graph features.");
  }
  if (!_driver) {
    _driver = neo4j.driver(
      env.NEO4J_URI as string,
      neo4j.auth.basic("neo4j", env.NEO4J_PASSWORD ?? "tiburcio"),
    );
  }
  return _driver;
}

export async function closeGraphDriver(): Promise<void> {
  if (_driver) {
    await _driver.close();
    _driver = null;
  }
}
```

#### `backend/src/graph/extractor.ts`

Extend the existing tree-sitter traversal (in `ast-chunker.ts`) to extract graph edges. Do NOT create a new tree-sitter parser — call the existing parse infrastructure and add a second traversal pass.

```typescript
// graph/extractor.ts — Extract graph relationships from already-parsed AST.
// Produces edges for Neo4j: IMPORTS, CALLS, EXTENDS, QUERIES.

export interface GraphNode {
  type: "File" | "Function" | "Class" | "Table";
  id: string;         // unique: filePath for File; filePath::name for others
  name: string;
  filePath: string;
  repo: string;
}

export interface GraphEdge {
  from: string;       // node id
  to: string;         // node id (may be unresolved import path)
  type: "IMPORTS" | "CALLS" | "EXTENDS" | "QUERIES";
  resolved: boolean;  // false = target is an unresolved external
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Extract graph data from a source file.
 * Uses the same language detection as ast-chunker.ts.
 * Returns empty arrays if file language is not supported.
 */
export function extractGraph(
  content: string,
  filePath: string,
  repo: string,
): GraphData { /* ... */ }
```

**Extraction rules:**

```
IMPORTS:
  TypeScript/Vue: import/require statements → resolve relative paths to absolute filePath
    - "../../services/payment" → resolve relative to importing file
    - "@company/pkg" → mark resolved: false (external)
  Java: import statements → map to file path if repo contains that class

CALLS:
  TypeScript: function call expressions → match by name, same-file first
    - Skip: dynamic dispatch (obj[method]()), chained (a.b.c()), callbacks
    - Include: direct calls like doSomething(), ServiceClass.method()
  Java: method invocations — same rules

EXTENDS:
  TypeScript: class Foo extends Bar → Class node Foo -[EXTENDS]-> Bar
  Java: class Foo extends Bar / implements Baz → separate EXTENDS edges

QUERIES (Table references):
  Java: @Table(name="orders") → Table node "orders"
        @Query("SELECT * FROM orders") → Table node "orders" (regex: FROM\s+(\w+))
        Repository class named OrderRepository → Table node "order" (strip Repository suffix)
  TypeScript: raw SQL strings (template literals with SELECT/INSERT) → regex extraction

SKIP if ambiguous:
  - Dynamic property access: obj[computed]()
  - Reflection-based calls
  - Wildcard imports: import * as X
  - Cannot resolve target after same-file + repo search → mark resolved: false, still record edge
```

#### `backend/src/graph/builder.ts`

```typescript
// graph/builder.ts — Full graph rebuild after Qdrant indexing.
// Runs as part of the nightly pipeline. Target: <5s for a single monolith.

import { getGraphDriver, isGraphAvailable } from "./client.js";
import { extractGraph } from "./extractor.js";

/**
 * Full graph rebuild for all repos.
 * Drops and recreates all nodes/edges for each repo.
 * Uses batch UNWIND inserts for performance.
 */
export async function buildGraph(repos: RepoConfig[]): Promise<{ nodes: number; edges: number }>;
```

**Cypher schema (run once on startup if graph available):**

```cypher
CREATE CONSTRAINT file_id IF NOT EXISTS FOR (f:File) REQUIRE f.id IS UNIQUE;
CREATE CONSTRAINT function_id IF NOT EXISTS FOR (f:Function) REQUIRE f.id IS UNIQUE;
CREATE CONSTRAINT class_id IF NOT EXISTS FOR (c:Class) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT table_id IF NOT EXISTS FOR (t:Table) REQUIRE t.id IS UNIQUE;
CREATE INDEX file_repo IF NOT EXISTS FOR (f:File) ON (f.repo);
```

**Batch upsert pattern:**

```cypher
UNWIND $nodes AS n
MERGE (f:File {id: n.id})
SET f.name = n.name, f.repo = n.repo, f.filePath = n.filePath

UNWIND $edges AS e
MATCH (a {id: e.from}), (b {id: e.to})
MERGE (a)-[r:IMPORTS]->(b)
```

**Full rebuild strategy:**

1. For each repo: `MATCH (n) WHERE n.repo = $repo DETACH DELETE n`
2. Extract graph from all source files (reuse `findSourceFiles` from index-codebase)
3. Batch upsert nodes (UNWIND, 500/batch)
4. Batch upsert edges (UNWIND, 500/batch)

#### `backend/src/mastra/tools/get-impact-analysis.ts`

```typescript
// tools/get-impact-analysis.ts — Graph traversal for dependency impact analysis.
// Returns "unavailable" when NEO4J_URI is not configured.

export async function executeGetImpactAnalysis(
  target: string,
  targetType: "file" | "function" | "class" | "table",
  depth: 1 | 2 | 3 = 2,
) {
  if (!isGraphAvailable()) {
    return {
      available: false,
      message: "Graph features require NEO4J_URI to be configured.",
    };
  }
  // Run Cypher query based on targetType ...
}
```

**Cypher queries per target type:**

```cypher
-- file: who imports this file (backwards traversal)
MATCH path = (dependent)-[:IMPORTS*1..$depth]->(target:File {filePath: $target})
RETURN dependent.filePath AS dependentFile, length(path) AS depth
ORDER BY depth, dependent.filePath

-- function: who calls this function
MATCH path = (caller)-[:CALLS*1..$depth]->(target:Function {name: $target})
RETURN caller.filePath AS callerFile, caller.name AS callerSymbol, length(path) AS depth
ORDER BY depth

-- class: who extends or calls methods of this class
MATCH path = (dependent)-[:EXTENDS|CALLS*1..$depth]->(target:Class {name: $target})
RETURN dependent.filePath AS dependentFile, dependent.name AS dependentName, length(path) AS depth
ORDER BY depth

-- table: what code queries this table (and their callers)
MATCH path = (caller)-[:QUERIES|CALLS*1..$depth]->(target:Table {name: $target})
RETURN caller.filePath AS callerFile, caller.name AS callerSymbol, length(path) AS depth
ORDER BY depth
```

**Return shape:**

```typescript
{
  available: true,
  target: "PaymentService",
  targetType: "class",
  depth: 2,
  dependents: [
    { file: "src/controllers/checkout.ts", symbol: "processPayment", depth: 1 },
    { file: "src/routes/order.ts", symbol: "createOrder", depth: 2 },
  ],
  summary: "2 direct dependents, 1 transitive. Changing PaymentService affects checkout.ts and order.ts."
}
```

---

### Files to Modify

#### `backend/src/config/env.ts`

Add to `baseSchema`:

```typescript
// Neo4j graph (optional — omit to disable graph features)
NEO4J_URI: z.string().optional(),      // e.g. bolt://localhost:7687
NEO4J_PASSWORD: z.string().optional(), // default: tiburcio
```

No Zod `.refine()` needed — the graph client's `isGraphAvailable()` check handles the "is it configured?" question at runtime.

#### `docker-compose.yml`

```yaml
neo4j:
  image: neo4j:5-community
  ports:
    - "127.0.0.1:7474:7474"
    - "127.0.0.1:7687:7687"
  environment:
    NEO4J_AUTH: neo4j/${NEO4J_PASSWORD:-tiburcio}
    NEO4J_server_memory_heap_max__size: 512m
    NEO4J_server_memory_pagecache_size: 256m
  volumes:
    - neo4j_data:/data
  profiles: ["graph"]

volumes:
  neo4j_data:
```

Start with graph: `docker compose --profile graph up -d`

#### `backend/src/mcp.ts`

Register the 10th tool:

```typescript
import { executeGetImpactAnalysis } from "./mastra/tools/get-impact-analysis.js";

server.registerTool(
  "getImpactAnalysis",
  {
    description:
      "Trace dependency impact for a file, function, class, or table. " +
      "Returns all code that depends on the target (directly + transitively). " +
      "Requires graph features to be configured (NEO4J_URI). " +
      "Returns 'unavailable' if graph is not configured.",
    inputSchema: {
      target: z.string().describe("File path, function name, class name, or table name"),
      targetType: z.enum(["file", "function", "class", "table"]),
      depth: z.number().min(1).max(3).default(2).describe("Traversal depth (1-3)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ target, targetType, depth }) => {
    const result = await executeGetImpactAnalysis(target, targetType, depth as 1 | 2 | 3);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);
```

Register the same tool in `backend/src/routes/mcp.ts`.

#### `backend/src/mastra/workflows/nightly-review.ts`

Add Step 4 after the existing 3 steps:

```typescript
// Step 4: Graph rebuild (optional)
async function buildGraphStep(): Promise<{ nodes: number; edges: number } | null> {
  if (!isGraphAvailable()) {
    logger.info("Neo4j not configured, skipping graph rebuild");
    return null;
  }
  const repos = getRepoConfigs();
  return buildGraph(repos);
}

// Enrich nightly summary with blast radius when graph is available
// Called from getNightlySummary when building the briefing text
```

**Blast radius enrichment in `get-nightly-summary.ts`:**

When graph is available, for each file in the `warningFiles` set, run a shallow impact analysis (depth=1) and append to the summary:

```
payment-service.ts changed — 3 files depend on it: checkout-controller.ts, order-service.ts, refund-handler.ts
```

This is a best-effort enrichment — if the graph query fails, the summary still returns without blast radius.

#### `backend/src/server.ts`

On graceful shutdown, close the Neo4j driver:

```typescript
import { closeGraphDriver } from "./graph/client.js";

// In shutdown handler:
await closeGraphDriver();
```

---

### New Dependency

```bash
cd backend && pnpm add neo4j-driver
```

**Version:** `neo4j-driver@5.x` (compatible with Neo4j 5 Community). Official Bolt protocol driver from Neo4j, Inc.

---

## Acceptance Criteria

### Change 2A — Contextual Chunk Enrichment

- [ ] `enrichChunkForEmbedding()` exported from `indexer/embed.ts`
- [ ] All `[File: ... | Language: ... | ...]` prefix fields present in embed text for code chunks
- [ ] `symbolName` and `parentSymbol` included when available; absent fields are omitted (no "Symbol: null")
- [ ] Original `chunk.content` (not enriched text) stored in Qdrant `text` payload field
- [ ] Both `index-codebase.ts` and `nightly-review.ts` use `enrichChunkForEmbedding()` — old prefix code removed
- [ ] `pnpm test` passes with updated mocks

### Change 2B — Embedding Cache

- [ ] `contentHash(text)` exported from `indexer/embed.ts`
- [ ] `contentHash` and `indexedAt` stored in Qdrant payload for every code chunk
- [ ] Full reindex skips embedding for chunks where `contentHash` matches existing payload
- [ ] Full reindex deletes orphan vectors (chunks whose IDs no longer exist in current files)
- [ ] Unchanged chunk count logged: "X of Y chunks skipped (hash match)"
- [ ] Test: hash match → `embedTexts` not called for that chunk
- [ ] Test: hash mismatch → `embedTexts` called
- [ ] Test: orphan IDs deleted after processing

### Change 2C — Parent-Child Links

- [ ] Verified: `index-codebase.ts:169-173` and `nightly-review.ts:166-172` are consistent — no code changes required

### Change 2D — Retrieval Confidence Threshold

- [ ] `RETRIEVAL_CONFIDENCE_THRESHOLD` added to `env.ts` with default `0.45`
- [ ] `RETRIEVAL_CODE_SCORE_THRESHOLD` added to `env.ts` with default `0.02` (RRF scores differ from cosine)
- [ ] 6 cosine-similarity tools filter by `RETRIEVAL_CONFIDENCE_THRESHOLD`
- [ ] `searchCode` filters by `RETRIEVAL_CODE_SCORE_THRESHOLD`
- [ ] Low-confidence response includes: actual top score, threshold, rephrase suggestion
- [ ] `getPattern` and `getNightlySummary` not modified (no cosine search)
- [ ] Test: results above threshold → returned normally
- [ ] Test: all results below threshold → `results: []` with message
- [ ] Test: empty results → existing empty-results message (not threshold message)

### Change 3 — Neo4j Graph Layer

- [ ] `docker compose --profile graph up -d` starts Neo4j on ports 7474/7687
- [ ] `isGraphAvailable()` returns `false` when `NEO4J_URI` not set; Tiburcio starts cleanly without Neo4j
- [ ] `getImpactAnalysis` tool registered in `mcp.ts` and `routes/mcp.ts`
- [ ] `getImpactAnalysis` returns `{ available: false }` when no `NEO4J_URI`
- [ ] Nightly pipeline runs Step 4 (graph rebuild) silently skipped when no `NEO4J_URI`
- [ ] Graph extraction covers all 4 node types and 4 edge types for TypeScript files
- [ ] Ambiguous edges skipped (not recorded); unresolvable imports recorded with `resolved: false`
- [ ] Batch UNWIND inserts; full rebuild <5s for a 100-file test repo
- [ ] Impact analysis returns correct dependents for all 4 `targetType` values
- [ ] Nightly summary includes blast radius text when graph available
- [ ] Test: all 4 impact analysis query types (mock Neo4j driver)
- [ ] Test: graceful degradation (no NEO4J_URI → `available: false`, no throw)
- [ ] `env.ts` includes `NEO4J_URI` and `NEO4J_PASSWORD` with correct optionality
- [ ] `.env.example` updated with `NEO4J_URI` and `NEO4J_PASSWORD`
- [ ] `docker-compose.yml` has neo4j service with `profiles: ["graph"]`

---

## Implementation Phases

### Phase 1: Change 2A + 2D (lowest risk, highest value)

These are the simplest changes and deliver immediate search quality improvements.

1. Add `enrichChunkForEmbedding()` to `indexer/embed.ts`
2. Update `index-codebase.ts` and `nightly-review.ts` to use it
3. Add `RETRIEVAL_CONFIDENCE_THRESHOLD` and `RETRIEVAL_CODE_SCORE_THRESHOLD` to `env.ts`
4. Add confidence filter to 7 affected tools
5. Update tests
6. `pnpm check && pnpm test` in backend/

**Trigger a re-index after deploying** — existing vectors were embedded without the enriched prefix and will have lower quality. Collection doesn't need to be dropped (dimensions unchanged), but re-indexing codebase will overwrite with better vectors.

### Phase 2: Change 2B (embedding cache)

More complex — changes the full-index strategy.

1. Add `contentHash()` to `indexer/embed.ts`
2. Update `processFile()` in `index-codebase.ts`:
   - Remove delete-all-upfront
   - Add batch retrieve → hash compare → selective embed
   - Add `contentHash` and `indexedAt` to payload
3. Add orphan cleanup via scroll + delete
4. Update `nightly-review.ts` incremental path (add hash check, keep per-file delete)
5. Update tests — mock `rawQdrant.retrieve()`, assert `embedTexts` skipped for hash-matched chunks
6. `pnpm check && pnpm test` in backend/

**Note:** First run after deploying 2B will embed all chunks (no existing `contentHash` in payloads). Subsequent runs will skip unchanged chunks. This is the expected bootstrap behavior.

### Phase 3: Change 3 — Neo4j (last, most complex)

1. `pnpm add neo4j-driver` in backend/
2. Create `backend/src/graph/client.ts`
3. Create `backend/src/graph/extractor.ts` — TypeScript extraction first, Java second
4. Create `backend/src/graph/builder.ts`
5. Add `NEO4J_URI`, `NEO4J_PASSWORD` to `env.ts`, `.env.example`
6. Add neo4j service to `docker-compose.yml` with `profiles: ["graph"]`
7. Create `backend/src/mastra/tools/get-impact-analysis.ts`
8. Register tool in `mcp.ts` and `routes/mcp.ts`
9. Update `nightly-review.ts` — add `buildGraphStep()` as Step 4
10. Update `get-nightly-summary.ts` — blast radius enrichment
11. Add `closeGraphDriver()` to server shutdown in `server.ts`
12. Add tests — mock `neo4j-driver` session
13. `pnpm check && pnpm test` in backend/

---

## What NOT to Change

- Qdrant 6 collections, dimensions, or collection names
- PostgreSQL schema or Drizzle migrations
- tree-sitter core parsing logic (extend only — no new parser)
- Vue 3 frontend
- Langfuse tracing hooks
- Existing 9 MCP tool names, descriptions, or input schemas
- Biome configuration
- BullMQ worker or cron schedule

## Documentation Updates Required

- `README.md` — add Neo4j section under Architecture; add `RETRIEVAL_CONFIDENCE_THRESHOLD` to env table
- `.env.example` — add `NEO4J_URI`, `NEO4J_PASSWORD`, `RETRIEVAL_CONFIDENCE_THRESHOLD`, `RETRIEVAL_CODE_SCORE_THRESHOLD`
- `CLAUDE.md` — update architecture section (enrichChunkForEmbedding, contentHash, graph client pattern)
- `docker-compose.yml` — neo4j service with profiles

---

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Hash cache increases full-index complexity | Medium | Medium | Phase 2 is isolated; if too complex, skip for now (2A+2D deliver most value) |
| Neo4j graph extraction accuracy <70% | Medium | Low | Wrong edges return `resolved: false`; tool still useful at 60% accuracy |
| RRF scores differ from cosine → threshold tuning needed | High | Low | Separate `RETRIEVAL_CODE_SCORE_THRESHOLD` env var; tune per team |
| Neo4j adds Docker dependency | Low | Low | `profiles: ["graph"]` makes it truly optional |
| Orphan cleanup scroll is slow for large repos | Low | Medium | 500-point pages; runs during nightly not request-time |

---

## Testing Strategy

**Mocks to add/update:**

```typescript
// For 2A tests (index-codebase.test.ts):
// Assert embedTexts receives enriched text (with [File: ... | ...] prefix)

// For 2B tests (index-codebase.test.ts):
// Add rawQdrant.retrieve mock
// Test: hash match → embedTexts not called for that chunk
// Test: hash mismatch → embedTexts called
// Test: orphan scroll + delete

// For 2D tests (tools.test.ts):
// Add confidence threshold tests per tool
// Test: score 0.3 with threshold 0.45 → { results: [], message: "..." }
// Test: score 0.6 with threshold 0.45 → results returned normally

// For Change 3 tests (new file: graph.test.ts):
// vi.mock("neo4j-driver") → mock Session + runMock
// Test: isGraphAvailable() false → getImpactAnalysis returns { available: false }
// Test: file target → IMPORTS traversal Cypher called
// Test: function target → CALLS traversal Cypher called
// Test: class target → EXTENDS|CALLS traversal Cypher called
// Test: table target → QUERIES traversal Cypher called
// Test: buildGraph() skipped when no NEO4J_URI
```

**Test file additions:**

- `backend/src/__tests__/graph.test.ts` — new file for Change 3
- `backend/src/__tests__/index-codebase.test.ts` — extend for 2A + 2B
- `backend/src/__tests__/tools.test.ts` — extend for 2D confidence threshold

---

## Sources & References

### Internal References

- Embedding prefix (to replace): `backend/src/indexer/index-codebase.ts:197-202`
- Same prefix in nightly path: `backend/src/mastra/workflows/nightly-review.ts:184-188`
- `createHash` already imported: `backend/src/indexer/embed.ts:4`
- headerChunkId linking (verified consistent): `backend/src/indexer/index-codebase.ts:169-173`, `backend/src/mastra/workflows/nightly-review.ts:166-172`
- All env vars: `backend/src/config/env.ts`
- Qdrant client singleton: `backend/src/mastra/infra.ts`
- Tool execute pattern: `backend/src/mastra/tools/search-code.ts:83-166`
- MCP registration pattern: `backend/src/mcp.ts:20-40`
- BullMQ nightly pipeline: `backend/src/jobs/queue.ts`
- Existing test mocks: `backend/src/__tests__/index-codebase.test.ts`, `backend/src/__tests__/tools.test.ts`

### External References

- Anthropic Contextual Retrieval technique (10-12% fewer retrieval failures with enriched embed text)
- Qdrant Query API + RRF fusion: https://qdrant.tech/documentation/concepts/search/#query-api
- Qdrant scroll API for orphan cleanup: https://qdrant.tech/documentation/concepts/points/#scroll-points
- Neo4j JavaScript driver: https://neo4j.com/docs/javascript-manual/current/
- Neo4j UNWIND batch insert: https://neo4j.com/docs/cypher-manual/current/clauses/unwind/
- neo4j-driver v5 npm package
