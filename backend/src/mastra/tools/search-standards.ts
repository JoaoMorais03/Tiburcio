// tools/search-standards.ts — Search team coding standards via Qdrant.

import { tool } from "ai";
import { z } from "zod";

import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { embedText } from "../../indexer/embed.js";
import { rawQdrant } from "../infra.js";
import { truncate } from "./truncate.js";

const COLLECTION = "standards";

export async function executeSearchStandards(query: string, category?: string, compact = true) {
  const embedding = await embedText(query);

  const filter = category ? { must: [{ key: "category", match: { value: category } }] } : undefined;

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
          "No matching standards found. " +
          (category
            ? "Try a different category (backend, frontend, database, integration). "
            : "") +
          "Try searchCode for implementations or getArchitecture for system design docs.",
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
      results: results.map((r) => ({
        title: (r.payload?.title as string) ?? "Untitled",
        category: (r.payload?.category as string) ?? "unknown",
        content: truncate((r.payload?.text as string) ?? "", 2000),
        tags: (r.payload?.tags as string[]) ?? [],
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
}

export const searchStandardsTool = tool({
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
    compact: z
      .boolean()
      .default(true)
      .describe(
        "When true (default), returns top 3 results. When false, returns top 5. " +
          "Standards content is always included in full (convention docs are short and directly useful).",
      ),
  }),
  execute: ({ query, category, compact }) => executeSearchStandards(query, category, compact),
});
