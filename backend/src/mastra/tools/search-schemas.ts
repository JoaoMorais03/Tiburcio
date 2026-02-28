// tools/search-schemas.ts — Search database schema docs via Qdrant.

import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";

import { logger } from "../../config/logger.js";
import { embedText } from "../../indexer/embed.js";
import { qdrant } from "../infra.js";
import { truncate } from "./truncate.js";

const COLLECTION = "schemas";

export const searchSchemas = createTool({
  id: "searchSchemas",
  mcp: {
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
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

  execute: async (inputData) => {
    const { query, tableName, compact } = inputData;

    const embedding = await embedText(query);

    const filter = tableName
      ? { must: [{ key: "tableName", match: { value: tableName } }] }
      : undefined;

    try {
      const results = await qdrant.query({
        indexName: COLLECTION,
        queryVector: embedding,
        topK: compact ? 3 : 5,
        filter,
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

      return {
        results: results.map((r) => ({
          tableName: r.metadata?.tableName ?? "unknown",
          description: r.metadata?.description ?? "",
          content: compact
            ? truncate((r.metadata?.text as string) ?? "", 300)
            : truncate((r.metadata?.text as string) ?? ""),
          relations: r.metadata?.relations ?? [],
          indexes: compact ? [] : (r.metadata?.indexes ?? []),
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
  },
});
