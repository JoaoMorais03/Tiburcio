// tools/search-code.ts — Search the indexed codebase via Qdrant.

import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";

import { logger } from "../../config/logger.js";
import { embedText } from "../../indexer/embed.js";
import { rerankResults } from "../../indexer/rerank.js";
import { qdrant } from "../infra.js";

const COLLECTION = "code-chunks";

export const searchCode = createTool({
  id: "searchCode",
  description:
    "Search real production code from the indexed codebase by semantic meaning. " +
    "Use this to find existing implementations, patterns, and examples. " +
    "For conventions and best practices, use searchStandards instead. " +
    "For code templates, use getPattern instead.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "What to search for, e.g. 'pagination in services' or 'notification email sending'",
      ),
    language: z
      .enum(["java", "typescript", "vue", "sql"])
      .optional()
      .describe("Filter by programming language"),
    layer: z
      .enum([
        "service",
        "controller",
        "repository",
        "model",
        "dto",
        "exception",
        "config",
        "constants",
        "common",
        "batch",
        "listener",
        "store",
        "component",
        "page",
        "composable",
        "federation",
        "boot",
        "router",
        "database",
        "other",
      ])
      .optional()
      .describe("Filter by architectural layer. For conventions, use searchStandards instead."),
  }),

  execute: async (inputData) => {
    const { query, language, layer } = inputData;

    const textToEmbed = [language, layer, query].filter(Boolean).join(" ");
    const embedding = await embedText(textToEmbed);

    const conditions: Array<{ key: string; match: { value: string } }> = [];
    if (language) conditions.push({ key: "language", match: { value: language } });
    if (layer) conditions.push({ key: "layer", match: { value: layer } });

    const filter = conditions.length > 0 ? { must: conditions } : undefined;

    try {
      let results = await qdrant.query({
        indexName: COLLECTION,
        queryVector: embedding,
        topK: 16,
        filter,
      });
      results = await rerankResults(textToEmbed, results, 8);

      if (results.length === 0) {
        return {
          results: [],
          message:
            "No matching code found. Suggestions: " +
            (language || layer ? "try removing the language/layer filter. " : "") +
            "Try searchStandards for conventions or getPattern for code templates.",
        };
      }

      return {
        results: results.map((r) => ({
          filePath: r.metadata?.filePath ?? "unknown",
          language: r.metadata?.language ?? "unknown",
          layer: r.metadata?.layer ?? "unknown",
          startLine: r.metadata?.startLine ?? 0,
          endLine: r.metadata?.endLine ?? 0,
          code: r.metadata?.text ?? "",
          score: r.score ?? 0,
        })),
      };
    } catch (err) {
      logger.error({ err, collection: COLLECTION }, "Tool query failed");
      return {
        results: [],
        message: "Code collection not yet indexed. Run indexing first.",
      };
    }
  },
});
