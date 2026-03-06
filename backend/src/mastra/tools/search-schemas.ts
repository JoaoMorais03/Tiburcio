// tools/search-schemas.ts — Search database schema docs via Qdrant.

import { tool } from "ai";
import { z } from "zod";

import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { embedText } from "../../indexer/embed.js";
import { rawQdrant } from "../infra.js";
import { truncate } from "./truncate.js";

const COLLECTION = "schemas";

export async function executeSearchSchemas(query: string, tableName?: string, compact = true) {
  const embedding = await embedText(query);

  const filter = tableName
    ? { must: [{ key: "tableName", match: { value: tableName } }] }
    : undefined;

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
          "No matching schema docs found. " +
          (tableName ? "Verify the table name or omit it to search all tables. " : "") +
          "Try getArchitecture with area 'database' for design docs.",
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
        tableName: (r.payload?.tableName as string) ?? "unknown",
        description: (r.payload?.description as string) ?? "",
        content: compact
          ? truncate((r.payload?.text as string) ?? "", 300)
          : truncate((r.payload?.text as string) ?? ""),
        relations: (r.payload?.relations as string[]) ?? [],
        indexes: compact ? [] : ((r.payload?.indexes as string[]) ?? []),
        score: r.score ?? 0,
      })),
    };
  } catch (err) {
    logger.error({ err, collection: COLLECTION }, "Tool query failed");
    return {
      results: [],
      message: "Schemas collection not yet indexed. Run indexing first.",
    };
  }
}

export const searchSchemasTool = tool({
  description:
    "Search the indexed project database schema documentation. " +
    "Returns table definitions, column details, relationships, and indexes. " +
    "For architecture flows involving the database, use getArchitecture with area 'database'.",
  inputSchema: z.object({
    query: z.string().describe("What to search for, e.g. 'request table columns'"),
    tableName: z
      .string()
      .optional()
      .describe("Filter by exact table name if known, e.g. 'request', 'project'"),
    compact: z
      .boolean()
      .default(true)
      .describe(
        "When true (default), returns table name, columns list, and brief description. " +
          "When false, returns full schema documentation.",
      ),
  }),
  execute: ({ query, tableName, compact }) => executeSearchSchemas(query, tableName, compact),
});
