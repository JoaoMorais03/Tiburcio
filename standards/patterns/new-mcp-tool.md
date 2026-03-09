# Pattern: New MCP Tool

## Steps

1. **Create the tool file** in `backend/src/mastra/tools/`:
   ```typescript
   // tools/search-foo.ts — Search foo collection via Qdrant.

   import { tool } from "ai";
   import { z } from "zod";

   import { logger } from "../../config/logger.js";
   import { embedText } from "../../indexer/embed.js";
   import { rawQdrant } from "../infra.js";
   import { truncate } from "./truncate.js";

   const COLLECTION = "foo";

   export async function executeSearchFoo(
     query: string,
     compact = true,
   ): Promise<{ results: Record<string, unknown>[] }> {
     const vector = await embedText(query);
     const hits = await rawQdrant.search(COLLECTION, {
       vector,
       limit: compact ? 3 : 8,
       with_payload: true,
     });

     const results = hits.map((h) => ({
       title: truncate((h.payload?.title as string) ?? "", compact ? 300 : 2000),
       score: h.score,
     }));

     return { results };
   }

   export const searchFooTool = tool({
     description: "Search foo for relevant information.",
     parameters: z.object({
       query: z.string().describe("What to search for"),
       compact: z.boolean().default(true),
     }),
     execute: async ({ query, compact }) => executeSearchFoo(query, compact),
   });
   ```

2. **Register in `mcp-tools.ts`** with `traceToolCall()` wrapper:
   ```typescript
   import { executeSearchFoo } from "./mastra/tools/search-foo.js";

   server.registerTool(
     "searchFoo",
     {
       description: "Search foo for relevant information.",
       inputSchema: {
         query: z.string().describe("What to search for"),
         compact: z.boolean().default(true),
       },
       annotations: { readOnlyHint: true, openWorldHint: false },
     },
     async ({ query, compact }) => {
       const result = await traceToolCall("searchFoo", { query, compact }, () =>
         executeSearchFoo(query, compact),
       );
       return { content: [{ type: "text", text: JSON.stringify(result) }] };
     },
   );
   ```

3. **Add to chat.ts tools object** so the tool is available in the streaming chat:
   ```typescript
   import { searchFooTool } from "../mastra/tools/search-foo.js";

   const tools = {
     // ... existing tools
     searchFoo: searchFooTool,
   };
   ```

4. **Write tests** in `__tests__/tools.test.ts` following the test file pattern.

## Conventions
- Export both `executeFoo()` (standalone async function) and `fooTool` (AI SDK tool object)
- Always declare `annotations: { readOnlyHint: true, openWorldHint: false }` for Claude Code optimization
- Use `compact` boolean param: 3 results with truncated previews (default) vs 5-8 full results
- Apply `truncate()` to all large text fields before returning (code: 1500, context: 800, general: 2000 chars)
- Import `z` from `"zod"` (v3), not `"zod/v4"` — AI SDK v6 requires Zod v3 types
- Use `.js` extensions in all imports (ESM)
