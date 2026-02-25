// tools/search-standards.ts — Search team coding standards via Qdrant.

import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";

import { logger } from "../../config/logger.js";
import { embedText } from "../../indexer/embed.js";
import { qdrant } from "../infra.js";
import { truncate } from "./truncate.js";

const COLLECTION = "standards";

export const searchStandards = createTool({
  id: "searchStandards",
  mcp: {
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  description:
    "Search your team's coding standards, conventions, and best practices. " +
    "Use this when you need to know HOW the team does something (transactions, " +
    "error handling, batch jobs, Vue patterns, etc.). " +
    "For actual code implementations, use searchCode instead. " +
    "For code templates, use getPattern instead.",
  inputSchema: z.object({
    query: z.string().describe("What to search for, e.g. 'batch job error handling'"),
    category: z
      .enum(["backend", "frontend", "database", "integration"])
      .optional()
      .describe("Filter by category to narrow results"),
  }),

  execute: async (inputData) => {
    const { query, category } = inputData;

    const embedding = await embedText(query);

    const filter = category
      ? { must: [{ key: "category", match: { value: category } }] }
      : undefined;

    try {
      const results = await qdrant.query({
        indexName: COLLECTION,
        queryVector: embedding,
        topK: 5,
        filter,
      });

      if (results.length === 0) {
        return {
          results: [],
          message:
            "No matching standards found. " +
            (category
              ? "Try a different category (backend, frontend, database, integration). "
              : "") +
            "Try searchCode for implementations or getArchitecture for system design docs.",
        };
      }

      return {
        results: results.map((r) => ({
          title: r.metadata?.title ?? "Untitled",
          category: r.metadata?.category ?? "unknown",
          content: truncate((r.metadata?.text as string) ?? "", 2000),
          tags: r.metadata?.tags ?? [],
          score: r.score ?? 0,
        })),
      };
    } catch (err) {
      logger.error({ err, collection: COLLECTION }, "Tool query failed");
      return {
        results: [],
        message: "Standards collection not yet indexed. Run indexing first.",
      };
    }
  },
});
