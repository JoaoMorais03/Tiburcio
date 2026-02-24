// tools/get-architecture.ts — Search architecture docs via Qdrant.

import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";

import { logger } from "../../config/logger.js";
import { embedText } from "../../indexer/embed.js";
import { rerankResults } from "../../indexer/rerank.js";
import { qdrant } from "../infra.js";

const COLLECTION = "architecture";

export const getArchitecture = createTool({
  id: "getArchitecture",
  description:
    "Search system architecture documentation for the indexed project. " +
    "Returns high-level flow descriptions showing how systems connect. " +
    "Available areas: auth, requests, batch, notifications, integrations, database, frontend, overview. " +
    "For coding standards, use searchStandards. For source code, use searchCode.",
  inputSchema: z.object({
    query: z.string().describe("What architecture area to search for, e.g. 'authentication flow'"),
    area: z
      .enum([
        "auth",
        "requests",
        "batch",
        "notifications",
        "integrations",
        "database",
        "frontend",
        "overview",
      ])
      .optional()
      .describe("Filter by architecture area to narrow results"),
  }),

  execute: async (inputData) => {
    const { query, area } = inputData;

    const embedding = await embedText(query);

    const filter = area ? { must: [{ key: "area", match: { value: area } }] } : undefined;

    try {
      let results = await qdrant.query({
        indexName: COLLECTION,
        queryVector: embedding,
        topK: 10,
        filter,
      });
      results = await rerankResults(query, results, 5);

      if (results.length === 0) {
        return {
          results: [],
          message:
            "No matching architecture docs found. " +
            "Available areas: auth, requests, batch, notifications, integrations, database, frontend, overview. " +
            (area ? "Try a different area or omit the area filter. " : "") +
            "Try searchStandards for conventions or searchCode for implementations.",
        };
      }

      return {
        results: results.map((r) => ({
          title: r.metadata?.title ?? "Untitled",
          area: r.metadata?.area ?? "unknown",
          content: r.metadata?.text ?? "",
          keyFiles: r.metadata?.keyFiles ?? [],
          score: r.score ?? 0,
        })),
      };
    } catch (err) {
      logger.error({ err, collection: COLLECTION }, "Tool query failed");
      return {
        results: [],
        message: "Architecture collection not yet indexed. Run indexing first.",
      };
    }
  },
});
