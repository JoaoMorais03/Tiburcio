// tools/get-test-suggestions.ts — Search AI-generated test suggestions via Qdrant.

import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";

import { logger } from "../../config/logger.js";
import { embedText } from "../../indexer/embed.js";
import { qdrant } from "../infra.js";
import { truncate } from "./truncate.js";

const COLLECTION = "test-suggestions";

export const getTestSuggestions = createTool({
  id: "getTestSuggestions",
  mcp: {
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  description:
    "Get AI-generated test suggestions for recently merged code. " +
    "Returns test scaffolds based on team conventions and existing test patterns. " +
    "Use when someone asks how to test something or wants to write tests for recent changes. " +
    "For what changed recently, use searchReviews first.",
  inputSchema: z.object({
    query: z.string().describe("What code to get test suggestions for, e.g. 'auth token refresh'"),
    language: z
      .enum(["java", "typescript", "vue"])
      .optional()
      .describe("Filter by programming language"),
  }),

  execute: async (inputData) => {
    const { query, language } = inputData;

    const textToEmbed = [language, query].filter(Boolean).join(" ");
    const embedding = await embedText(textToEmbed);

    const conditions: Array<{ key: string; match: { value: string } }> = [];
    if (language) conditions.push({ key: "language", match: { value: language } });

    const filter = conditions.length > 0 ? { must: conditions } : undefined;

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
            "No test suggestions found. The nightly pipeline may not have run yet. " +
            (language ? "Try removing the language filter. " : "") +
            "Try searchReviews for recent changes, or searchCode for existing test files.",
        };
      }

      return {
        results: results.map((r) => ({
          suggestion: truncate((r.metadata?.text as string) ?? "", 2000),
          targetFile: r.metadata?.targetFile ?? "unknown",
          testType: r.metadata?.testType ?? "unit",
          language: r.metadata?.language ?? "unknown",
          commitSha: r.metadata?.commitSha ?? "",
          date: r.metadata?.date ?? "",
          score: r.score ?? 0,
        })),
      };
    } catch (err) {
      logger.error({ err, collection: COLLECTION }, "Tool query failed");
      return {
        results: [],
        message:
          "Test suggestions collection not yet indexed. The nightly pipeline may not have run yet.",
      };
    }
  },
});
