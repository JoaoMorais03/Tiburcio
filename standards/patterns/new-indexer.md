# Pattern: New Indexer

## Steps

1. **Create the indexer** in `backend/src/indexer/index-foo.ts`:
   ```typescript
   // indexer/index-foo.ts — Index foo documents into Qdrant.

   import { readFile } from "node:fs/promises";
   import { relative } from "node:path";
   import pLimit from "p-limit";

   import { logger } from "../config/logger.js";
   import { ensureCollection, rawQdrant } from "../mastra/infra.js";
   import { embedTexts, toUUID } from "./embed.js";
   import { splitText } from "./text-splitter.js";

   const COLLECTION = "foo";
   const limit = pLimit(3);

   function chunkId(relPath: string, index: number): string {
     return toUUID(`${COLLECTION}:${relPath}:${index}`);
   }

   export async function indexFoo(
     sourceDir: string,
   ): Promise<{ files: number; chunks: number }> {
     const files = await findSourceFiles(sourceDir);
     if (files.length === 0) return { files: 0, chunks: 0 };

     await ensureCollection(COLLECTION);
     let totalChunks = 0;

     await Promise.all(
       files.map((filePath) =>
         limit(async () => {
           const content = await readFile(filePath, "utf-8");
           const relPath = relative(sourceDir, filePath);
           const chunks = splitText(content, 1000, 100);
           if (chunks.length === 0) return;

           const embeddings = await embedTexts(chunks.map((c) => c.text));

           await rawQdrant.upsert(COLLECTION, {
             wait: true,
             points: chunks.map((c, i) => ({
               id: chunkId(relPath, i),
               vector: embeddings[i],
               payload: { text: c.text, filePath: relPath },
             })),
           });

           totalChunks += chunks.length;
           logger.info({ filePath: relPath, chunks: chunks.length }, "Indexed file");
         }),
       ),
     );

     logger.info({ files: files.length, chunks: totalChunks }, "Indexing complete");
     return { files: files.length, chunks: totalChunks };
   }
   ```

2. **Add a BullMQ job** in `jobs/queue.ts` following the BullMQ job pattern.

3. **Add auto-index on startup** in `server.ts`:
   ```typescript
   const collections = await listCollections();
   if (!collections.includes("foo")) {
     await indexQueue.add("index-foo", {} as Record<string, never>, {
       jobId: "boot-foo",
     });
   }
   ```

4. **Add admin trigger** in `routes/admin.ts` for manual reindexing.

5. **Write tests** that mock `rawQdrant.upsert()`, `ensureCollection()`, and `embedTexts()`.

## Conventions
- Use `p-limit(3)` for file-level concurrency — safe for inference API rate limits
- Import `ensureCollection` and `rawQdrant` from `mastra/infra.js` (single source of truth)
- Use `toUUID()` from `embed.js` for deterministic chunk IDs (prevents duplicates on re-index)
- Apply `redactSecrets()` from `indexer/redact.js` before embedding if content may contain secrets
- Return `{ files, chunks }` stats from the indexer for logging and job tracking
- Use `.js` extensions in all imports (ESM)
