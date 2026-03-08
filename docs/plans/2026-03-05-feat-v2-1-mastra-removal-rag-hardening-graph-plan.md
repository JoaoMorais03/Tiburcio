---
title: "Tiburcio v2.1 — Mastra Removal, RAG Hardening, Neo4j Graph Layer"
type: feat
status: active
date: 2026-03-05
---

# Tiburcio v2.1 — Mastra Removal, RAG Hardening, Neo4j Graph Layer

## Overview

Three sequential changes that transform Tiburcio from a Mastra-wrapped black box into a lean, direct-SDK stack — then harden the RAG pipeline and add an optional graph layer for dependency-aware impact analysis.

**Latency budget (non-negotiable):** Total MCP tool response ≤ 5–10s.
Current: Qdrant hybrid search (~50–200ms) + single LLM synthesis (~1–3s) = ~2–4s. Zero new LLM calls on the query-time hot path.

**Implementation order:** Change 1 (Mastra removal) → Change 2 (RAG hardening) → Change 3 (Neo4j graph).

---

## Complete Mastra Import Map

> Read before writing a single line of code. Every `@mastra/*` usage and its replacement.

### Package: `@mastra/qdrant` — `QdrantVector` wrapper

| File | Usage | Replace with |
|------|-------|-------------|
| `backend/src/mastra/infra.ts:11,19` | `new QdrantVector({ url, id })` — simple upsert/query/list for non-sparse collections | Direct `rawQdrant` (`QdrantClient`) — already in the codebase. Use points API for upsert, search API for query |

**Impact:** `qdrant.upsert()`, `qdrant.query()`, `qdrant.createIndex()`, `qdrant.listIndexes()`, `qdrant.deleteIndex()` all move to `rawQdrant` equivalents. The `rawQdrant` client is already used for sparse/hybrid — extend it to cover all operations.

### Package: `@mastra/core/tools` — `createTool`

| File | Usage |
|------|-------|
| `backend/src/mastra/tools/search-standards.ts:3` | `createTool({ id, mcp, description, inputSchema, execute })` |
| `backend/src/mastra/tools/search-code.ts:4` | same |
| `backend/src/mastra/tools/search-schemas.ts:3` | same |
| `backend/src/mastra/tools/search-reviews.ts:3` | same |
| `backend/src/mastra/tools/get-architecture.ts:3` | same |
| `backend/src/mastra/tools/get-test-suggestions.ts:3` | same |
| `backend/src/mastra/tools/get-nightly-summary.ts:4` | same |
| `backend/src/mastra/tools/get-change-summary.ts:4` | same |
| `backend/src/mastra/tools/get-pattern.ts:5` | same |

**Replace with:** Two exports per tool file:
1. Core `execute` function (plain async, shared by AI SDK tool and MCP registration)
2. AI SDK `tool()` wrapper (for `streamText` in chat route)

MCP tool annotations (`readOnlyHint`, `openWorldHint`) move to MCP server registration.

### Package: `@mastra/core/agent` — `Agent` class

| File | Usage | Replace with |
|------|-------|-------------|
| `backend/src/mastra/agents/chat-agent.ts:3` | `new Agent({ model, tools, memory, instructions })` with `.stream()` | Vercel AI SDK `streamText({ model, system, messages, tools, maxSteps })` + history loaded from PG `messages` table |
| `backend/src/mastra/agents/code-review-agent.ts:4` | `new Agent({ model, tools, instructions })` with `.generate()` | Vercel AI SDK `generateText({ model, system, messages, tools })` |

### Package: `@mastra/core/processors` — `UnicodeNormalizer`

| File | Usage | Replace with |
|------|-------|-------------|
| `backend/src/mastra/agents/chat-agent.ts:4` | `new UnicodeNormalizer({ stripControlChars: true })` | Inline: `message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim()` before passing to `streamText` |

### Package: `@mastra/core` — `Mastra` instance

| File | Usage | Replace with |
|------|-------|-------------|
| `backend/src/mastra/index.ts:3` | `new Mastra({ agents, vectors, workflows, observability })` | Delete file entirely — nothing consumes the Mastra instance except `MastraServer` |

### Package: `@mastra/hono` — `MastraServer`

| File | Usage | Replace with |
|------|-------|-------------|
| `backend/src/server.ts:6` | `new MastraServer({ app, mastra })` + `mastraServer.init()` + `/api/mastra/*` route | Delete — the Mastra playground routes are not used by the chat UI or any production path |

### Package: `@mastra/mcp` — `MCPServer`

| File | Usage | Replace with |
|------|-------|-------------|
| `backend/src/mcp.ts:4` | `new MCPServer({ id, name, version, tools })` + `.startStdio()` | `@modelcontextprotocol/sdk` `McpServer` + `StdioServerTransport` |
| `backend/src/routes/mcp.ts:10` | `new MCPServer({ ... })` + `.startHonoSSE({ url, ssePath, messagePath, context })` | `McpServer` + manual Hono SSE handler (see implementation notes) |

### Package: `@mastra/memory` — `Memory`

| File | Usage | Replace with |
|------|-------|-------------|
| `backend/src/mastra/memory.ts:4` | `new Memory({ storage, vector, embedder, options })` — semantic recall + working memory | Delete. Chat history loaded directly from PG `messages` table (last 20 messages). Semantic cross-conversation recall is dropped as an acceptable simplification |

### Package: `@mastra/pg` — `PostgresStore`, `PgVector`

| File | Usage | Replace with |
|------|-------|-------------|
| `backend/src/mastra/memory.ts:5` | PG-backed agent memory storage | Delete (memory module removed) |

### Package: `@mastra/rag` — `MDocument`

| File | Usage | Replace with |
|------|-------|-------------|
| `backend/src/indexer/index-standards.ts:5` | `MDocument.fromText(content).chunk({ strategy: "recursive", maxSize: 1000, overlap: 100 })` | Own recursive text splitter: `splitText(content, { maxSize, overlap })` — ~25 lines, no dep |
| `backend/src/indexer/index-architecture.ts:5` | same with `maxSize: 800, overlap: 100` / `maxSize: 600, overlap: 80` | same |

### Package: `@mastra/langfuse` + `@mastra/observability`

| File | Usage | Replace with |
|------|-------|-------------|
| `backend/src/mastra/index.ts:4,5` | `LangfuseExporter`, `Observability` | Drop observability for now. Can add back via AI SDK's `experimental_telemetry` + direct Langfuse SDK in a follow-up |

---

## Change 1: Remove Mastra — Direct AI SDK + MCP SDK

### Step 1: Install / Remove Dependencies

```bash
# Add
pnpm add @modelcontextprotocol/sdk ollama-ai-provider @ai-sdk/openai

# Remove
pnpm remove @mastra/core @mastra/hono @mastra/mcp @mastra/memory \
            @mastra/pg @mastra/qdrant @mastra/rag \
            @mastra/langfuse @mastra/observability
```

`@ai-sdk/openai-compatible` stays (may still be used for Ollama fallback path).
`@openrouter/ai-sdk-provider` is removed — OpenRouter now goes through `@ai-sdk/openai` (openai-compatible endpoint).

### Step 2: Model Provider Abstraction

**New file: `backend/src/lib/model-provider.ts`**

Three backends unified behind two env vars:

```typescript
// lib/model-provider.ts
import { ollama } from 'ollama-ai-provider';
import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModelV1, LanguageModelV1 } from '@ai-sdk/provider';
import { env } from '../config/env.js';

function createOpenAICompatible() {
  return createOpenAI({
    baseURL: env.INFERENCE_BASE_URL,
    apiKey: env.INFERENCE_API_KEY || 'not-needed',
  });
}

export function getChatModel(): LanguageModelV1 {
  if (env.MODEL_PROVIDER === 'ollama') {
    return ollama(env.OLLAMA_CHAT_MODEL) as unknown as LanguageModelV1;
  }
  return createOpenAICompatible()(env.INFERENCE_MODEL) as unknown as LanguageModelV1;
}

export function getEmbeddingModel(): EmbeddingModelV1<string> {
  if (env.MODEL_PROVIDER === 'ollama') {
    return ollama.embedding(env.OLLAMA_EMBEDDING_MODEL) as unknown as EmbeddingModelV1<string>;
  }
  return createOpenAICompatible().embedding(env.INFERENCE_EMBEDDING_MODEL) as unknown as EmbeddingModelV1<string>;
}
```

**Updated `backend/src/config/env.ts`** — rename provider vars:

```
MODEL_PROVIDER: z.enum(["ollama", "openai-compatible"]).default("ollama")

# New vars (replacing OpenRouter-specific ones):
INFERENCE_BASE_URL: z.string().optional()     # vLLM or OpenRouter base URL
INFERENCE_API_KEY: z.string().optional()      # API key (empty = not-needed for local vLLM)
INFERENCE_MODEL: z.string().optional()        # e.g. "minimax/minimax-m2.5" or local model name
INFERENCE_EMBEDDING_MODEL: z.string().optional()

# Keep Ollama vars unchanged:
OLLAMA_BASE_URL, OLLAMA_CHAT_MODEL, OLLAMA_EMBEDDING_MODEL
```

Zod `.refine()` validates: if `MODEL_PROVIDER=openai-compatible` then `INFERENCE_BASE_URL` and `INFERENCE_MODEL` must be set.

### Step 3: New Infra — Replace QdrantVector

**Updated `backend/src/mastra/infra.ts`** (keep filename for now, rename directory in a future cleanup):

```typescript
// infra.ts — remove @mastra/qdrant, keep rawQdrant for all operations
import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../config/env.js";

export const rawQdrant = new QdrantClient({ url: env.QDRANT_URL });

// Replace QdrantVector methods with direct rawQdrant calls:
export async function listCollections(): Promise<string[]> {
  const { collections } = await rawQdrant.getCollections();
  return collections.map(c => c.name);
}

export async function deleteCollection(name: string): Promise<void> {
  await rawQdrant.deleteCollection(name);
}

export async function ensureCollection(name: string, dimensions = env.EMBEDDING_DIMENSIONS as number, sparse = false): Promise<void> { ... }

// chatModel + embeddingModel now imported from lib/model-provider.ts
export { getChatModel as chatModel, getEmbeddingModel as embeddingModel } from '../lib/model-provider.js';
```

**Impact on indexers:** `index-standards.ts` and `index-architecture.ts` switch from `qdrant.upsert()` (Mastra wrapper) to `rawQdrant.upsert()` (standard Qdrant points format). The search tools using `qdrant.query()` switch to `rawQdrant.search()`.

### Step 4: Text Chunker (Replaces MDocument)

**New `backend/src/indexer/text-splitter.ts`** — replaces `@mastra/rag` `MDocument`:

```typescript
// text-splitter.ts — recursive character text splitter
export interface TextChunk { text: string; startChar: number; }

export function splitText(text: string, maxSize = 1000, overlap = 100): TextChunk[] {
  // Split on paragraphs → sentences → words, keep chunks under maxSize with overlap
  // ~25 lines of straightforward string operations
}
```

Used in `index-standards.ts` and `index-architecture.ts` replacing the `MDocument` call.

### Step 5: MCP Server — Official SDK

**Updated `backend/src/mcp.ts`** (stdio):

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { executeSearchStandards } from "./mastra/tools/search-standards.js";
// ... import all 9 core execute functions

const server = new McpServer({ name: "tiburcio", version: "2.1.0" });

server.registerTool("searchStandards", {
  description: "Search your team's coding standards...",
  inputSchema: { query: z.string(), category: z.string().optional(), compact: z.boolean().default(true) },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async ({ query, category, compact }) => {
  const result = await executeSearchStandards(query, category, compact);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});
// ... register all 9 tools

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Updated `backend/src/routes/mcp.ts`** (HTTP/SSE):

The `@modelcontextprotocol/sdk` does not ship a Hono adapter. The SSE MCP transport is a simple protocol:
- `GET /sse` → long-lived SSE stream, server pushes events
- `POST /message` → client sends JSON-RPC messages

Implement with Hono's native SSE (`streamSSE`) and the SDK's `SSEServerTransport`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

// The SSEServerTransport constructor takes (endpoint: string, res: ServerResponse)
// Hono's streaming API gives us a compatible writer interface.
// Implement a thin adapter that bridges Hono's stream to SSEServerTransport.
```

> **Implementation note:** If `SSEServerTransport` requires Node `ServerResponse` directly, use `@hono/node-server`'s `getNodeContext(c)` to get the raw request/response. This is a well-understood pattern.

> **Alternative:** Write ~50 lines of raw SSE protocol handling in Hono (no SDK dep needed for the HTTP layer, just the MCP server logic). Prefer this if the SDK adapter is complex.

### Step 6: Chat Agent — Direct streamText

**Updated `backend/src/routes/chat.ts`**:

```typescript
import { streamText, tool } from 'ai';
import { getChatModel } from '../lib/model-provider.js';
import { executeSearchStandards } from '../mastra/tools/search-standards.js';
// ... import all tool execute functions

const CHAT_SYSTEM_PROMPT = `You are Tiburcio...`; // same instructions from chat-agent.ts

chatRouter.post("/stream", async (c) => {
  // ... existing auth + validation + conversation resolution ...

  // Load last 20 messages from conversation
  const history = await db.select().from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt)
    .limit(20);

  // Sanitize input (replaces UnicodeNormalizer)
  const sanitized = message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();

  const { textStream } = streamText({
    model: getChatModel(),
    system: CHAT_SYSTEM_PROMPT,
    messages: [
      ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: sanitized },
    ],
    tools: { searchStandards: searchStandardsTool, searchCode: searchCodeTool, ... },
    maxSteps: 10, // allow tool calling loop
    abortSignal: c.req.raw.signal,
  });

  return streamSSE(c, async (sseStream) => {
    await sseStream.writeSSE({ event: "conversation", data: JSON.stringify({ conversationId }) });
    let fullResponse = '';
    for await (const chunk of textStream) {
      fullResponse += chunk;
      if (fullResponse.length > MAX_RESPONSE_SIZE) break;
      await sseStream.writeSSE({ event: "token", data: JSON.stringify({ token: chunk }) });
    }
    // ... save + done event (unchanged)
  });
});
```

### Step 7: Nightly Review — Plain Async Function

**Updated `backend/src/mastra/workflows/nightly-review.ts`**:

Replace `createStep`/`createWorkflow` with a plain async function containing the same three sequential steps:

```typescript
export async function runNightlyReview(): Promise<{ suggestions: number }> {
  const reindexResult = await incrementalReindex();
  const reviewResult = await codeReview(reindexResult);
  const suggestionsResult = await testSuggestions(reviewResult);
  return suggestionsResult;
}
```

Each step is an extracted async function (same logic, no Mastra wrappers).

`codeReviewAgent.generate()` → `generateText({ model: getChatModel(), system: CODE_REVIEW_SYSTEM_PROMPT, messages: [...], tools: {...} })`.

**Updated `backend/src/jobs/queue.ts`**:

```typescript
case "nightly-review": {
  await runNightlyReview();  // was: nightlyReviewWorkflow.createRun() etc.
  break;
}
```

### Step 8: Server Cleanup

**Updated `backend/src/server.ts`**:

Remove:
- `import { MastraServer } from "@mastra/hono"`
- `import { mastra, qdrant } from "./mastra/index.js"` → import `listCollections`, `deleteCollection` from infra directly
- `const mastraServer = new MastraServer({ app, mastra })`
- `await mastraServer.init()`
- `app.use("/api/mastra/*", cookieAuth)`
- `mcpServer` import from routes/mcp (or keep for shutdown)

Health check uses `listCollections()` instead of `qdrant.listIndexes()`.

### Step 9: Delete Dead Files

- `backend/src/mastra/index.ts`
- `backend/src/mastra/memory.ts`
- `backend/src/mastra/agents/` → contents either deleted or merged into `routes/chat.ts` and `nightly-review.ts`

### Step 10: Verify

```bash
pnpm check   # Biome + tsc — zero errors
pnpm test    # all tests pass
# Manual: claude mcp add tiburcio -- npx tsx src/mcp.ts → test searchStandards
# Manual: start server, open chat UI, send a message
```

---

## Change 2: RAG Hardening (All Index-Time)

> All changes are index-time only. Zero query-time overhead.

### 2A: Contextual Chunk Enrichment

Prepend structured metadata to text BEFORE embedding. Store original text in Qdrant payload.

**Add to `backend/src/indexer/index-codebase.ts`** and `nightly-review.ts`:

```typescript
function enrichChunkForEmbedding(chunk: CodeChunk, context: string): string {
  const meta = [
    chunk.filePath && `File: ${chunk.filePath}`,
    chunk.language && `Language: ${chunk.language}`,
    chunk.className && `Class: ${chunk.className}`,
    chunk.parentFunction && `Parent: ${chunk.parentFunction}`,
  ].filter(Boolean).join(' | ');
  const prefix = meta ? `[${meta}]` : '';
  return context
    ? `${prefix}\n${context}\n\n${chunk.content}`
    : `${prefix}\n${chunk.content}`;
}
```

Apply to all 6 collections. The existing `nightly-review.ts` already prepends `${c.language} ${c.layer} ${c.filePath}` — replace that with `enrichChunkForEmbedding()` for consistency.

### 2B: Embedding Cache via Content Hashing

SHA-256 per chunk. Check existing Qdrant point by ID (which is already `toUUID(repo:file:line)`) before re-embedding.

**Add to `backend/src/indexer/embed.ts`**:

```typescript
import { createHash } from 'node:crypto';

export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
```

**In `index-codebase.ts` and `nightly-review.ts`**:

Before embedding a batch, retrieve existing point payloads by ID (`rawQdrant.retrieve(COLLECTION, { ids, with_payload: true })`). Compare `contentHash`. Skip re-embedding for matching hashes. Update `contentHash` field in payload on upsert.

```typescript
{ ..., payload: { ..., contentHash: contentHash(enrichedText), indexedAt: new Date().toISOString() } }
```

This turns O(all chunks) → O(changed chunks) for unchanged files.

### 2C: Parent-Child Chunk Links

Already partially implemented via `headerChunkId`. Extend to all chunk types:

- `parentId`: UUID of the parent chunk (e.g., the class-level chunk for a method-level chunk)
- Already stored and used in `search-code.ts` via `fetchHeaders()` + `headerMap`

No change needed for the mechanism — the enrichment from 2A makes this more useful by including class context in the parent chunk's embedding. Verify `headerChunkId` is consistently set across both `index-codebase.ts` and `nightly-review.ts`.

### 2D: Retrieval Confidence Threshold

**Add to `backend/src/config/env.ts`**:

```typescript
RETRIEVAL_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.45),
```

**Add to all search tools** (after Qdrant query returns, before mapping results):

```typescript
const threshold = env.RETRIEVAL_CONFIDENCE_THRESHOLD;
const confident = results.filter(r => (r.score ?? 0) >= threshold);

if (confident.length === 0) {
  return {
    results: [],
    message: `No results met confidence threshold (${threshold}). Try rephrasing or use searchCode instead.`,
    lowConfidence: true,
  };
}
```

~0ms overhead. Prevents hallucination from near-zero-score results.

---

## Change 3: Neo4j Graph Layer (Optional)

### Docker Setup (optional profile)

```yaml
# Add to docker-compose.yml
neo4j:
  image: neo4j:5-community
  profiles: ["graph"]
  ports:
    - "127.0.0.1:7474:7474"
    - "127.0.0.1:7687:7687"
  environment:
    NEO4J_AUTH: neo4j/${NEO4J_PASSWORD:-tiburcio}
    NEO4J_server_memory_heap_max__size: 512m
    NEO4J_server_memory_pagecache__size: 256m
  volumes:
    - neo4j_data:/data
  deploy:
    resources:
      limits:
        memory: 1G
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://localhost:7474/ || exit 1"]
    interval: 10s
    timeout: 5s
    retries: 10
    start_period: 30s
  restart: unless-stopped
```

Usage: `docker compose --profile graph up -d`

### Graph Client — Graceful Degradation

**New `backend/src/graph/client.ts`**:

```typescript
import neo4j, { Driver } from 'neo4j-driver';
import { env } from '../config/env.js';

let _driver: Driver | null = null;

export function isGraphAvailable(): boolean {
  return !!env.NEO4J_URI;
}

export function getGraphDriver(): Driver | null {
  if (!isGraphAvailable()) return null;
  if (!_driver) {
    _driver = neo4j.driver(env.NEO4J_URI!, neo4j.auth.basic('neo4j', env.NEO4J_PASSWORD!));
  }
  return _driver;
}

export async function closeGraphDriver(): Promise<void> {
  await _driver?.close();
  _driver = null;
}
```

All graph-using code checks `isGraphAvailable()` first. Nothing breaks without Neo4j.

### Scope: 4 Nodes, 4 Edges

```
Nodes: File, Function, Class, Table
Edges: IMPORTS, CALLS, EXTENDS, QUERIES
```

Do NOT model: packages, interfaces, annotations, config, generics, parameters, return types.

### Relationship Extraction

**New `backend/src/graph/extractor.ts`**:

Extend the existing tree-sitter traversal in `ast-chunker.ts`. Do NOT create a parallel parser.

```typescript
export interface GraphNode { type: 'File' | 'Function' | 'Class' | 'Table'; name: string; filePath: string; }
export interface GraphEdge { type: 'IMPORTS' | 'CALLS' | 'EXTENDS' | 'QUERIES'; from: string; to: string; }

export async function extractRelationships(filePath: string, content: string, language: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  // 1. IMPORTS — parse import/require statements, resolve to relative file paths
  // 2. FUNCTION CALLS — extract function calls, match same-file first (skip dynamic dispatch)
  // 3. CLASS INHERITANCE — extends/implements declarations
  // 4. TABLE REFERENCES — @Table, @Entity annotations; SQL strings in @Query; repo naming
  // Rule: if ambiguous, skip. Wrong edges are worse than missing edges.
}
```

### Nightly Pipeline Integration

After Qdrant indexing step in `runNightlyReview()`:

```typescript
if (isGraphAvailable()) {
  await rebuildGraph(repos);
}
```

**New `backend/src/graph/builder.ts`**:

```typescript
export async function rebuildGraph(repos: RepoConfig[]): Promise<void> {
  const driver = getGraphDriver();
  if (!driver) return;

  // Drop all nodes (full rebuild — target <5s for monolith)
  // Batch UNWIND inserts for nodes then edges
  // Use MERGE to avoid duplicates
}
```

Batch size: 500 nodes/edges per `UNWIND`. Full graph rebuild after each nightly Qdrant index.

### New MCP Tool: `getImpactAnalysis`

**New `backend/src/mastra/tools/get-impact-analysis.ts`**:

```typescript
export async function executeGetImpactAnalysis(target: string, targetType: 'file' | 'function' | 'class' | 'table', depth: number) {
  if (!isGraphAvailable()) {
    return { unavailable: true, message: 'Graph layer not configured. Set NEO4J_URI to enable impact analysis.' };
  }

  const driver = getGraphDriver()!;
  const session = driver.session();

  try {
    // Cypher per target type:
    // file:     MATCH (f:File {path: $target})<-[:IMPORTS*1..$depth]-(caller) RETURN caller
    // function: MATCH (fn:Function {name: $target})<-[:CALLS*1..$depth]-(caller) RETURN caller
    // table:    MATCH (t:Table {name: $target})<-[:QUERIES*1..$depth]-(caller) RETURN caller
    // class:    MATCH (c:Class {name: $target})<-[:EXTENDS|CALLS*1..$depth]-(caller) RETURN caller

    // Return: { target, targetType, depth, dependents: [{ name, filePath, hops }], count }
  } finally {
    await session.close();
  }
}
```

Register in both stdio MCP (`mcp.ts`) and HTTP MCP (`routes/mcp.ts`).

Input schema: `{ target: z.string(), targetType: z.enum(['file','function','class','table']), depth: z.number().int().min(1).max(3).default(2) }`

### Nightly Summary Enrichment

**In `backend/src/mastra/tools/get-nightly-summary.ts`** `executeGetNightlySummary()`:

```typescript
if (isGraphAvailable()) {
  // For each file in warningFiles, check graph for dependents
  // Append: "payment-service.ts changed — 5 files depend on it (order-controller.ts, checkout-flow.ts)"
  // Single Cypher query across all warning files (batch lookup)
}
```

---

## Files Changed Per Change

### Change 1 (Mastra Removal)

| File | Action |
|------|--------|
| `backend/src/lib/model-provider.ts` | NEW — getChatModel, getEmbeddingModel |
| `backend/src/indexer/text-splitter.ts` | NEW — replaces MDocument |
| `backend/src/mastra/infra.ts` | REWRITE — remove QdrantVector, wire model-provider |
| `backend/src/config/env.ts` | EDIT — rename OpenRouter vars to INFERENCE_* |
| `backend/src/mastra/tools/*.ts` (all 9) | EDIT — split into executeX() + AI SDK tool() |
| `backend/src/indexer/index-standards.ts` | EDIT — MDocument → text-splitter, qdrant → rawQdrant |
| `backend/src/indexer/index-architecture.ts` | EDIT — same |
| `backend/src/mcp.ts` | REWRITE — MCPServer → @modelcontextprotocol/sdk |
| `backend/src/routes/mcp.ts` | REWRITE — MCPServer → @modelcontextprotocol/sdk + Hono SSE adapter |
| `backend/src/mastra/workflows/nightly-review.ts` | REWRITE — createWorkflow → plain async function |
| `backend/src/routes/chat.ts` | EDIT — chatAgent.stream → streamText |
| `backend/src/server.ts` | EDIT — remove MastraServer |
| `backend/src/jobs/queue.ts` | EDIT — workflow.createRun → runNightlyReview() |
| `backend/src/mastra/index.ts` | DELETE |
| `backend/src/mastra/memory.ts` | DELETE |
| `backend/src/mastra/agents/` | DELETE (logic merged into routes/chat.ts and nightly-review.ts) |
| `.env.example` | EDIT — OPENROUTER_* → INFERENCE_* |

### Change 2 (RAG Hardening)

| File | Action |
|------|--------|
| `backend/src/indexer/embed.ts` | EDIT — add contentHash() |
| `backend/src/indexer/index-codebase.ts` | EDIT — enrichChunkForEmbedding, hash cache |
| `backend/src/mastra/workflows/nightly-review.ts` | EDIT — same enrichment in incremental reindex |
| `backend/src/indexer/index-standards.ts` | EDIT — enrichment |
| `backend/src/indexer/index-architecture.ts` | EDIT — enrichment |
| `backend/src/mastra/tools/*.ts` (all 9) | EDIT — confidence threshold check |
| `backend/src/config/env.ts` | EDIT — RETRIEVAL_CONFIDENCE_THRESHOLD |

### Change 3 (Neo4j Graph)

| File | Action |
|------|--------|
| `backend/src/graph/client.ts` | NEW |
| `backend/src/graph/extractor.ts` | NEW |
| `backend/src/graph/builder.ts` | NEW |
| `backend/src/mastra/tools/get-impact-analysis.ts` | NEW |
| `backend/src/mastra/workflows/nightly-review.ts` | EDIT — add graph rebuild step |
| `backend/src/mastra/tools/get-nightly-summary.ts` | EDIT — blast radius enrichment |
| `backend/src/mcp.ts` | EDIT — register getImpactAnalysis |
| `backend/src/routes/mcp.ts` | EDIT — same |
| `backend/src/config/env.ts` | EDIT — NEO4J_URI, NEO4J_PASSWORD |
| `docker-compose.yml` | EDIT — neo4j service with "graph" profile |
| `package.json` | EDIT — add neo4j-driver |

---

## Technical Considerations

### MCP SDK HTTP Transport — Key Decision

The `@modelcontextprotocol/sdk` ships `SSEServerTransport` which expects Node.js `IncomingMessage` and `ServerResponse`. Two viable paths:

1. **`getNodeContext(c)` from `@hono/node-server`** — extracts raw Node req/res from Hono context. Minimal glue code.
2. **Implement raw SSE protocol directly** — `GET /sse` sends `event: endpoint\ndata: /mcp/message\n\n` then keeps connection alive; `POST /message` proxies to `McpServer.handleRequest()`. ~50 lines, zero external SSE deps.

Prefer option 2 if option 1 requires fighting the SSE transport constructor signature.

### Tool Architecture — Two-Layer Pattern

Each tool file exports two things:

```typescript
// 1. Core logic (pure async, testable in isolation)
export async function executeSearchStandards(query: string, category?: string, compact = true) { ... }

// 2. AI SDK tool wrapper (used by streamText in chat route)
export const searchStandardsTool = tool({
  description: "...",
  parameters: z.object({ query: z.string(), category: z.string().optional(), compact: z.boolean().default(true) }),
  execute: ({ query, category, compact }) => executeSearchStandards(query, category, compact),
});
```

MCP registration calls `executeSearchStandards` directly. Tests mock at the `execute` layer.

### Memory Simplification — Accepted Tradeoff

Dropping `@mastra/memory` removes:
- Semantic recall across old conversations (vector similarity on past messages)
- Working memory (structured user profile that updates)
- Observational memory (LLM-extracted observations)

What remains: last 20 messages from PG `messages` table, passed as `messages[]` to `streamText`. This is correct for the vast majority of conversations. If semantic cross-session recall becomes needed, it can be added as a dedicated feature with explicit memory tools (e.g., a `saveMemory`/`recallMemory` pattern).

### Embedding Model Migration on Provider Change

The server startup logic in `server.ts` checks Redis `tiburcio:embedding-model` key. The model ID format needs updating for the new provider naming:
- Was: `ollama:nomic-embed-text` or `openrouter:qwen/qwen3-embedding-8b`
- Now: `ollama:nomic-embed-text` or `openai-compatible:<INFERENCE_EMBEDDING_MODEL>`

Update the ID construction in `server.ts` startup.

### Langfuse Observability — Future Path

The AI SDK supports OpenTelemetry via `experimental_telemetry: { isEnabled: true }` on any `generateText`/`streamText` call. Langfuse has an OpenTelemetry endpoint. This can be wired up in a small follow-up without Mastra dependencies.

---

## Acceptance Criteria

### Change 1 — Mastra Removal

- [ ] Zero `@mastra/*` imports in the codebase
- [ ] `pnpm check` passes (Biome + tsc) with zero errors
- [ ] All 136 backend tests pass (`pnpm test`)
- [ ] MCP stdio: `claude mcp add tiburcio -- npx tsx src/mcp.ts` — all 9 tools respond correctly
- [ ] MCP HTTP/SSE: connects via `Authorization: Bearer <TEAM_API_KEY>`, all tools work
- [ ] Chat UI: `POST /api/chat/stream` streams responses with tool calls
- [ ] Both `MODEL_PROVIDER=ollama` and `MODEL_PROVIDER=openai-compatible` work
- [ ] All MCP tool response times remain under 5s

### Change 2 — RAG Hardening

- [ ] Enriched text is used for embedding (not stored in payload)
- [ ] Original content stored in Qdrant payload unchanged
- [ ] Re-indexing unchanged files skips embedding calls (hash match)
- [ ] Confidence threshold filters near-zero results with informative message
- [ ] `RETRIEVAL_CONFIDENCE_THRESHOLD` env var works (default 0.45)
- [ ] No query latency regression (embedding cache is index-time only)
- [ ] All tests pass

### Change 3 — Neo4j Graph

- [ ] `docker compose --profile graph up -d` starts Neo4j correctly
- [ ] `isGraphAvailable()` returns false when `NEO4J_URI` is unset — nothing breaks
- [ ] `getImpactAnalysis` returns `unavailable` message when graph not configured
- [ ] `getImpactAnalysis` returns correct dependents for all 4 target types
- [ ] Nightly pipeline graph rebuild completes in <5s for a typical monolith
- [ ] Nightly summary includes blast radius info when graph is configured
- [ ] All graph queries complete in <50ms
- [ ] Graph unavailable → all 9 existing tools unaffected

---

## System-Wide Impact

### Interaction Graph

**Chat flow changes (Change 1):**
1. `POST /api/chat/stream` → `streamText()` (was `chatAgent.stream()`)
2. `streamText` internally calls tool `execute()` functions during tool-use steps
3. Tool execute functions call Qdrant → return results → `streamText` continues generating
4. SSE tokens stream to client (unchanged format)
5. Final message saved to PG `messages` table (unchanged)

**No change to:** auth middleware, rate limiters, conversation DB writes, SSE event format.

### Error Propagation

- Tool `execute()` functions wrap Qdrant errors and return empty results with guidance messages (existing pattern, unchanged)
- `streamText` propagates tool errors as stream errors → caught in SSE handler → `error` SSE event sent to client
- Nightly workflow errors: `runNightlyReview()` throws → BullMQ catches → job retry (unchanged)

### State Lifecycle Risks

- **Memory removal:** `@mastra/memory` stored data in PG tables (Mastra-managed schema). These tables become orphaned but harmless. Document in migration notes that `mastra_*` PG tables can be dropped manually after confirming the new system works.
- **Embedding model ID format change:** The Redis key `tiburcio:embedding-model` changes format. On first startup after v2.1, the key won't match → triggers collection drop + reindex. This is the correct behavior (handled by existing startup logic). Document in CHANGELOG.

### API Surface Parity

Both MCP transports (stdio `mcp.ts` + HTTP `routes/mcp.ts`) must register identical tools with identical schemas and annotations. The `executeX()` core functions ensure logic parity. Registration boilerplate in each file must be kept in sync — add a comment noting this.

### Integration Test Scenarios

1. **Tool call loop:** Send "how do we handle transactions?" → should call `searchStandards` → tool result → final response. Verify full loop works end-to-end in chat.
2. **Model provider switch:** Set `MODEL_PROVIDER=openai-compatible` with a local vLLM endpoint → both chat and nightly pipeline use it.
3. **Confidence threshold:** Index a single unrelated document, query for something very different → should return `lowConfidence: true` response.
4. **Graph degradation:** Start without `NEO4J_URI` → `getImpactAnalysis` returns `unavailable`, all other tools unaffected.
5. **Hash cache:** Run `index-codebase` twice without changes → second run skips all embedding calls.

---

## Environment Variables (v2.1 Complete)

```env
# Provider: "ollama" (local, zero API calls) or "openai-compatible" (vLLM, OpenRouter, etc.)
MODEL_PROVIDER=ollama

# Ollama (used when MODEL_PROVIDER=ollama)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=qwen3:8b
OLLAMA_EMBEDDING_MODEL=nomic-embed-text

# OpenAI-compatible (used when MODEL_PROVIDER=openai-compatible)
INFERENCE_BASE_URL=                        # e.g. https://openrouter.ai/api/v1 or http://vllm:8000/v1
INFERENCE_API_KEY=                         # empty for local vLLM, key for OpenRouter
INFERENCE_MODEL=                           # e.g. minimax/minimax-m2.5 or local model name
INFERENCE_EMBEDDING_MODEL=                 # e.g. qwen/qwen3-embedding-8b

# Infrastructure (unchanged)
DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6379
QDRANT_URL=http://localhost:6333
JWT_SECRET=                                # min 32 chars
TEAM_API_KEY=                              # Bearer auth for MCP HTTP transport

# RAG (new)
RETRIEVAL_CONFIDENCE_THRESHOLD=0.45

# Neo4j Graph (optional — omit to disable graph layer)
NEO4J_URI=bolt://localhost:7687
NEO4J_PASSWORD=tiburcio

# Langfuse observability (optional — unchanged)
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=

# Misc (unchanged)
CODEBASE_REPOS=name:path:branch
CORS_ORIGINS=http://localhost:5173
PORT=3000
NODE_ENV=development
```

---

## Testing Plan

### Change 1 Tests

| Test | File | Mock |
|------|------|------|
| `getChatModel()` returns correct model for each provider | `lib/model-provider.test.ts` | process.env |
| `getEmbeddingModel()` returns correct model for each provider | same | process.env |
| MCP tool registration — all 9 tools registered with correct schemas | `mcp.test.ts` | `@modelcontextprotocol/sdk` |
| `executeSearchStandards` called by MCP handler | `routes/mcp.test.ts` | rawQdrant |
| Chat route: history loaded and passed to streamText | `chat.test.ts` | `ai` streamText mock |
| `runNightlyReview` calls all 3 steps in order | `nightly-review.test.ts` | generateText mock |
| `splitText` produces correct chunks with overlap | `text-splitter.test.ts` | none |
| `listCollections` returns collection names | `infra.test.ts` | rawQdrant mock |

### Change 2 Tests

| Test | File |
|------|------|
| `contentHash` is deterministic and produces 16-char hex | `embed.test.ts` |
| `enrichChunkForEmbedding` includes all available metadata fields | `index-codebase.test.ts` |
| Hash cache: retrieve existing → skip embed for matching hash | `index-codebase.test.ts` |
| Hash cache: re-embed when hash differs | same |
| Confidence threshold: results below 0.45 filtered → `lowConfidence: true` | `tools.test.ts` |
| Confidence threshold: results above 0.45 pass through | same |

### Change 3 Tests

| Test | File | Mock |
|------|------|------|
| `isGraphAvailable()` false without NEO4J_URI | `graph/client.test.ts` | process.env |
| `isGraphAvailable()` true with NEO4J_URI | same | same |
| `executeGetImpactAnalysis` returns `unavailable` without graph | `tools.test.ts` | isGraphAvailable mock |
| `executeGetImpactAnalysis` file target — correct Cypher fired | `get-impact-analysis.test.ts` | neo4j-driver mock |
| `executeGetImpactAnalysis` function target — correct Cypher | same | same |
| `executeGetImpactAnalysis` table target — correct Cypher | same | same |
| `executeGetImpactAnalysis` class target — correct Cypher | same | same |
| `extractRelationships` extracts IMPORTS from TypeScript file | `graph/extractor.test.ts` | none |
| `extractRelationships` extracts CALLS | same | none |
| `rebuildGraph` uses UNWIND for batch inserts | `graph/builder.test.ts` | neo4j-driver mock |

---

## What NOT to Change

- Qdrant 6 collections and their schemas
- PostgreSQL/Drizzle schema (`db/schema.ts`)
- Tree-sitter core parsing logic (`ast-chunker.ts`) — only extend
- Vue 3 frontend (zero changes)
- Langfuse integration (drop now, add back via OTel later)
- Nightly cron schedule (2:00 AM via BullMQ)
- Existing MCP tool names, descriptions, and output schemas
- Biome config, TypeScript config
- `.tibignore` support, secret redaction

## What to Update

- `README.md` — remove Mastra references, add direct SDK architecture, document Neo4j profile
- `CHANGELOG.md` — v2.1.0 entry
- `CLAUDE.md` — update Architecture section (provider abstraction), File Layout (new graph/ dir), Gotchas (embedding model ID format change)
- `.env.example` — rename OPENROUTER_* → INFERENCE_*
- `docker-compose.yml` — Neo4j service with "graph" profile

---

## Sources & References

### Internal References

- All Mastra imports: `backend/src/mastra/infra.ts`, `backend/src/mastra/index.ts`, `backend/src/mcp.ts`, `backend/src/routes/mcp.ts`, all tool files
- Nightly workflow: `backend/src/mastra/workflows/nightly-review.ts`
- Chat agent usage: `backend/src/routes/chat.ts:56-58`
- BullMQ job runner: `backend/src/jobs/queue.ts:51-57`
- Existing hybrid search (preserve): `backend/src/mastra/tools/search-code.ts:159-168`
- Existing confidence scores already available from Qdrant: `backend/src/mastra/tools/search-code.ts:171`

### External References

- MCP TypeScript SDK: `@modelcontextprotocol/sdk` (server/mcp, server/stdio, server/sse)
- Vercel AI SDK: `streamText`, `generateText`, `tool`, `embed` from `ai`
- `ollama-ai-provider` — native Ollama API provider for AI SDK
- `@ai-sdk/openai` — `createOpenAI` for any OpenAI-compatible endpoint
- Neo4j JavaScript Driver: `neo4j-driver`
- Cypher batch pattern: `UNWIND $rows AS row MERGE (n:Type {id: row.id}) SET n += row`
