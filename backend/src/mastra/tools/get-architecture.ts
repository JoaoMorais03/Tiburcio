// tools/get-architecture.ts — Search architecture docs via Qdrant.

import { tool } from "ai";
import { z } from "zod";

import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { embedText } from "../../indexer/embed.js";
import { rawQdrant } from "../infra.js";
import { truncate } from "./truncate.js";

const COLLECTION = "architecture";

export async function executeGetArchitecture(query: string, area?: string, compact = true) {
  const embedding = await embedText(query);

  const filter = area ? { must: [{ key: "area", match: { value: area } }] } : undefined;

  try {
    const results = await rawQdrant.search(COLLECTION, {
      vector: embedding,
      limit: compact ? 3 : 5,
      filter,
      with_payload: true,
    });

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

    const threshold = env.RETRIEVAL_CONFIDENCE_THRESHOLD as number;
    const topScore = results[0]?.score ?? 0;
    if (topScore < threshold) {
      logger.info({ topScore, threshold }, "Results below confidence threshold");
      return {
        results: [],
        message: `No high-confidence results found (best score: ${topScore.toFixed(3)}, threshold: ${threshold}). Try rephrasing the query or using a different tool.`,
      };
    }

    return {
      results: results.map((r) => {
        const text = (r.payload?.text as string) ?? "";
        return {
          title: (r.payload?.title as string) ?? "Untitled",
          area: (r.payload?.area as string) ?? "unknown",
          content: compact ? truncate(text, 200) : truncate(text, 2000),
          keyFiles: (r.payload?.keyFiles as string[]) ?? [],
          score: r.score ?? 0,
        };
      }),
    };
  } catch (err) {
    logger.error({ err, collection: COLLECTION }, "Tool query failed");
    return {
      results: [],
      message: "Architecture collection not yet indexed. Run indexing first.",
    };
  }
}

export const getArchitectureTool = tool({
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
    compact: z
      .boolean()
      .default(true)
      .describe(
        "When true (default), returns title + summary + keyFiles pointers. " +
          "When false, returns full architecture document content.",
      ),
  }),
  execute: ({ query, area, compact }) => executeGetArchitecture(query, area, compact),
});
