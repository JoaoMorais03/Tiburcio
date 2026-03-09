# Pattern: New Test File

## Steps

1. **Create the test file** in `backend/src/__tests__/`:
   ```typescript
   // __tests__/my-feature.test.ts — Tests for my feature (mocked deps).

   import { beforeEach, describe, expect, it, vi } from "vitest";

   vi.mock("../indexer/embed.js", () => ({
     embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
   }));

   vi.mock("../mastra/infra.js", () => ({
     rawQdrant: { search: vi.fn(), query: vi.fn(), retrieve: vi.fn() },
   }));

   vi.mock("../indexer/bm25.js", () => ({
     textToSparse: vi.fn(() => ({ indices: [1, 2], values: [1.0, 1.0] })),
   }));

   vi.mock("../config/logger.js", () => ({
     logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
   }));

   vi.mock("../config/env.js", () => ({
     env: { EMBEDDING_DIMENSIONS: 3 },
   }));

   vi.mock("../lib/model-provider.js", () => ({
     getChatModel: vi.fn(() => ({})),
     getEmbeddingModel: vi.fn(() => ({})),
   }));
   ```

2. **Import after mocks** — all `vi.mock()` calls must come before any imports of mocked modules:
   ```typescript
   import { embedText } from "../indexer/embed.js";
   import { rawQdrant } from "../mastra/infra.js";
   ```

3. **Use the `qdrantHit` helper** to build mock Qdrant results:
   ```typescript
   function qdrantHit(score: number, payload: Record<string, unknown>) {
     return { id: "abc-123", version: 0, score, payload };
   }
   ```

4. **Write describe/it blocks** with setup in `beforeEach`:
   ```typescript
   describe("myFeature", () => {
     beforeEach(() => {
       vi.clearAllMocks();
     });

     it("returns results for a valid query", async () => {
       vi.mocked(rawQdrant.search).mockResolvedValue([
         qdrantHit(0.9, { text: "example", filePath: "src/foo.ts" }),
       ]);

       const result = await executeMyTool("test query");
       expect(result.results).toHaveLength(1);
     });
   });
   ```

5. **Handle env.ts side effect** — if your module imports `config/env.js`, set required env vars in `beforeAll` before dynamic imports:
   ```typescript
   beforeAll(() => {
     process.env.JWT_SECRET = "a".repeat(32);
     process.env.DATABASE_URL = "postgres://localhost/test";
   });
   ```

## Conventions
- All mocks are declared before imports (Vitest hoists `vi.mock()` calls)
- No real external services — mock Qdrant, Redis, embeddings, and LLM calls
- Use `vi.clearAllMocks()` in `beforeEach` to prevent test leakage
- Use `.js` extensions in all import paths and mock paths (ESM requirement)
- Run `pnpm check && pnpm test` in `backend/` before committing
