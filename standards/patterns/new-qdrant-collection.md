# Pattern: New Qdrant Collection

## Steps

1. **Create the collection** using `ensureCollection()` from `mastra/infra.ts`:
   ```typescript
   import { ensureCollection, rawQdrant } from "../mastra/infra.js";

   // Dense-only collection (uses EMBEDDING_DIMENSIONS from env)
   await ensureCollection("my-collection");

   // Sparse-enabled collection (dense "dense" + sparse "bm25" named vectors)
   await ensureCollection("my-collection", env.EMBEDDING_DIMENSIONS, true);
   ```

2. **Choose dense-only or sparse-enabled** based on your search needs:
   ```typescript
   // Dense-only: simple cosine similarity search
   const hits = await rawQdrant.search("my-collection", {
     vector,
     limit: 5,
     with_payload: true,
   });

   // Sparse-enabled: hybrid search with RRF fusion (dense + BM25)
   const hits = await rawQdrant.query("my-collection", {
     prefetch: [
       { query: vector, using: "dense", limit: 20 },
       { query: { indices, values }, using: "bm25", limit: 20 },
     ],
     query: { fusion: "rrf" },
     limit: 8,
     with_payload: true,
   });
   ```

3. **Upsert points** with the correct vector format:
   ```typescript
   // Dense-only collection
   await rawQdrant.upsert("my-collection", {
     wait: true,
     points: [{
       id: toUUID("my-collection:doc:0"),
       vector: embedding,
       payload: { text: "content", title: "My Doc" },
     }],
   });

   // Sparse-enabled collection (named vectors)
   await rawQdrant.upsert("my-collection", {
     wait: true,
     points: [{
       id: toUUID("my-collection:doc:0"),
       vector: {
         dense: embedding,
         bm25: { indices, values },
       },
       payload: { text: "content", filePath: "src/foo.ts" },
     }],
   });
   ```

4. **Add startup check** in `server.ts` to auto-index if the collection is missing:
   ```typescript
   const collections = await listCollections();
   if (!collections.includes("my-collection")) {
     await indexQueue.add("index-my-collection", {} as Record<string, never>, {
       jobId: "boot-my-collection",
     });
   }
   ```

## Conventions
- Always use `ensureCollection()` from `mastra/infra.js` — never call `rawQdrant.createCollection()` directly
- `EMBEDDING_DIMENSIONS` auto-detects: 768 for Ollama/nomic-embed-text, 4096 for openai-compatible/qwen3-embedding-8b
- Use `rawQdrant` for all vector operations — it is the single Qdrant client
- Chunk IDs use `toUUID()` for deterministic, collision-free UUIDs
- Sparse-enabled collections use named vectors (`dense` + `bm25`) — currently only `code-chunks` needs this
- Dense-only collections use unnamed vectors (simpler upsert and search)
- Six existing collections: standards, code-chunks, architecture, schemas, reviews, test-suggestions
