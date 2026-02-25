// tools/search-code.ts — Search the indexed codebase via Qdrant.
// v1.1: Query expansion + hybrid search (dense + BM25 RRF) + header chunk expansion.

import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";

import { logger } from "../../config/logger.js";
import { textToSparse } from "../../indexer/bm25.js";
import { embedText } from "../../indexer/embed.js";
import { expandQuery } from "../../indexer/query-expand.js";
import { rerankResults } from "../../indexer/rerank.js";
import { rawQdrant } from "../infra.js";

const COLLECTION = "code-chunks";

/** Fetch a single point by ID from Qdrant. Returns the payload or null. */
async function fetchPoint(id: string): Promise<Record<string, unknown> | null> {
  try {
    const points = await rawQdrant.retrieve(COLLECTION, {
      ids: [id],
      with_payload: true,
    });
    return (points[0]?.payload as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

export const searchCode = createTool({
  id: "searchCode",
  description:
    "Search real production code from the indexed codebase using hybrid search (semantic + keyword matching). " +
    "Returns enriched results with symbolName, classContext, annotations, and exact line ranges. " +
    "Use this to find existing implementations, patterns, and examples. " +
    "For conventions and best practices, use searchStandards instead. " +
    "For code templates, use getPattern instead.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "What to search for, e.g. 'pagination in services' or 'notification email sending'",
      ),
    repo: z
      .string()
      .optional()
      .describe("Filter by repository name (e.g. 'api', 'ui', 'batch'). Omit to search all repos."),
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
    const { query, repo, language, layer } = inputData;

    // Phase 4: Expand query into semantic variants for broader recall
    const variants = await expandQuery(query);

    // Build Qdrant filter conditions
    const conditions: Array<{ key: string; match: { value: string } }> = [];
    if (repo) conditions.push({ key: "repo", match: { value: repo } });
    if (language) conditions.push({ key: "language", match: { value: language } });
    if (layer) conditions.push({ key: "layer", match: { value: layer } });
    const filter = conditions.length > 0 ? { must: conditions } : undefined;

    try {
      // Embed all query variants in parallel
      const embeddingPromises = variants.map((v) => {
        const textToEmbed = [language, layer, v].filter(Boolean).join(" ");
        return embedText(textToEmbed);
      });
      const denseVectors = await Promise.all(embeddingPromises);

      // Phase 5: Build prefetch queries — dense + sparse for each variant
      const prefetch: Array<{
        query: number[] | { indices: number[]; values: number[] };
        using: string;
        limit: number;
        filter?: typeof filter;
      }> = [];

      for (const denseVec of denseVectors) {
        prefetch.push({ query: denseVec, using: "dense", limit: 20, filter });
      }
      for (const variant of variants) {
        const sparseText = [language, layer, variant].filter(Boolean).join(" ");
        prefetch.push({
          query: textToSparse(sparseText),
          using: "bm25",
          limit: 20,
          filter,
        });
      }

      // Hybrid search with RRF fusion
      const rawResults = await rawQdrant.query(COLLECTION, {
        prefetch,
        query: { fusion: "rrf" },
        limit: 16,
        with_payload: true,
      });

      // Convert to QueryResult format for rerankResults compatibility
      const queryResults = rawResults.points.map((p) => ({
        id: String(p.id),
        score: p.score ?? 0,
        metadata: (p.payload ?? {}) as Record<string, unknown>,
      }));

      const reranked = await rerankResults(query, queryResults, 8);

      if (reranked.length === 0) {
        return {
          results: [],
          message:
            "No matching code found. Suggestions: " +
            (language || layer ? "try removing the language/layer filter. " : "") +
            "Try searchStandards for conventions or getPattern for code templates.",
        };
      }

      // Phase 3: Expand header chunks for method-level results
      const results = await Promise.all(
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: result mapping with conditional header expansion is inherently branchy
        reranked.map(async (r) => {
          const headerChunkId = r.metadata?.headerChunkId as string | null;
          let classContext: string | null = null;
          if (headerChunkId && r.metadata?.chunkType !== "header") {
            const header = await fetchPoint(headerChunkId);
            classContext = (header?.text as string) ?? null;
          }
          return {
            repo: (r.metadata?.repo as string) ?? "unknown",
            filePath: (r.metadata?.filePath as string) ?? "unknown",
            language: (r.metadata?.language as string) ?? "unknown",
            layer: (r.metadata?.layer as string) ?? "unknown",
            startLine: (r.metadata?.startLine as number) ?? 0,
            endLine: (r.metadata?.endLine as number) ?? 0,
            code: (r.metadata?.text as string) ?? "",
            symbolName: (r.metadata?.symbolName as string) ?? null,
            parentSymbol: (r.metadata?.parentSymbol as string) ?? null,
            chunkType: (r.metadata?.chunkType as string) ?? "other",
            annotations: (r.metadata?.annotations as string[]) ?? [],
            classContext,
            score: r.score ?? 0,
          };
        }),
      );

      return { results };
    } catch (err) {
      logger.error({ err, collection: COLLECTION }, "Tool query failed");
      return {
        results: [],
        message: "Code collection not yet indexed. Run indexing first.",
      };
    }
  },
});
