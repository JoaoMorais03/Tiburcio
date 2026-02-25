// tools/search-reviews.ts — Search nightly code review insights via Qdrant.

import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";

import { logger } from "../../config/logger.js";
import { embedText } from "../../indexer/embed.js";
import { qdrant } from "../infra.js";
import { truncate } from "./truncate.js";

const COLLECTION = "reviews";

export const searchReviews = createTool({
  id: "searchReviews",
  mcp: {
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  description:
    "Search recent code review insights from automated nightly reviews. " +
    "Use this when someone asks about recent changes, known issues, " +
    "what happened in a specific area of the codebase recently, or " +
    "what to test from yesterday's merges. " +
    "For test scaffolds based on those reviews, use getTestSuggestions.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("What to search for, e.g. 'recent auth changes' or 'yesterday warnings'"),
    severity: z
      .enum(["info", "warning", "critical"])
      .optional()
      .describe("Filter by severity level"),
    category: z
      .enum(["convention", "bug", "security", "pattern", "architecture"])
      .optional()
      .describe("Filter by review category"),
  }),

  execute: async (inputData) => {
    const { query, severity, category } = inputData;

    const embedding = await embedText(query);

    const conditions: Array<{ key: string; match: { value: string } }> = [];
    if (severity) conditions.push({ key: "severity", match: { value: severity } });
    if (category) conditions.push({ key: "category", match: { value: category } });

    const filter = conditions.length > 0 ? { must: conditions } : undefined;

    try {
      const results = await qdrant.query({
        indexName: COLLECTION,
        queryVector: embedding,
        topK: 8,
        filter,
      });

      if (results.length === 0) {
        return {
          results: [],
          message:
            "No review insights found. The nightly review may not have run yet. " +
            (severity || category ? "Try removing the severity/category filter. " : "") +
            "Try searchCode for the actual code, or getTestSuggestions for test scaffolds.",
        };
      }

      return {
        results: results.map((r) => ({
          review: truncate((r.metadata?.text as string) ?? ""),
          severity: r.metadata?.severity ?? "info",
          category: r.metadata?.category ?? "unknown",
          filePath: r.metadata?.filePath ?? "unknown",
          commitSha: r.metadata?.commitSha ?? "",
          author: r.metadata?.author ?? "unknown",
          date: r.metadata?.date ?? "",
          mergeMessage: truncate((r.metadata?.mergeMessage as string) ?? "", 300),
          score: r.score ?? 0,
        })),
      };
    } catch (err) {
      logger.error({ err, collection: COLLECTION }, "Tool query failed");
      return {
        results: [],
        message: "Reviews collection not yet indexed. The nightly review may not have run yet.",
      };
    }
  },
});
