// tools/search-code.ts — Search the indexed codebase via Qdrant.
// Pipeline: embed → hybrid search (dense + BM25 RRF) → batch header expansion.

import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";

import { logger } from "../../config/logger.js";
import { textToSparse } from "../../indexer/bm25.js";
import { embedText } from "../../indexer/embed.js";
import { rawQdrant } from "../infra.js";
import { truncate } from "./truncate.js";

const COLLECTION = "code-chunks";

interface QdrantPoint {
  id: string | number;
  score?: number;
  payload?: Record<string, unknown>;
}

function mapPointToCompact(p: QdrantPoint) {
  const m = (p.payload ?? {}) as Record<string, unknown>;
  const text = (m.text as string) ?? "";
  const firstLine = text.split("\n").find((l) => l.trim()) ?? "";
  return {
    filePath: (m.filePath as string) ?? "unknown",
    symbolName: (m.symbolName as string) ?? null,
    lineRange: `${(m.startLine as number) ?? 0}-${(m.endLine as number) ?? 0}`,
    summary: truncate(firstLine, 120),
    score: p.score ?? 0,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: flat ?? chains for metadata fallbacks
function mapPointToFull(p: QdrantPoint, headerMap: Map<string, string>) {
  const m = (p.payload ?? {}) as Record<string, unknown>;
  const headerChunkId = m.headerChunkId as string | null;
  const needsHeader = headerChunkId && m.chunkType !== "header";
  return {
    repo: (m.repo as string) ?? "unknown",
    filePath: (m.filePath as string) ?? "unknown",
    language: (m.language as string) ?? "unknown",
    layer: (m.layer as string) ?? "unknown",
    startLine: (m.startLine as number) ?? 0,
    endLine: (m.endLine as number) ?? 0,
    code: truncate((m.text as string) ?? ""),
    symbolName: (m.symbolName as string) ?? null,
    parentSymbol: (m.parentSymbol as string) ?? null,
    chunkType: (m.chunkType as string) ?? "other",
    annotations: (m.annotations as string[]) ?? [],
    classContext: truncate((needsHeader ? headerMap.get(headerChunkId) : null) ?? "", 800),
    score: p.score ?? 0,
  };
}

/** Fetch header chunks in a single batch retrieve call. */
async function fetchHeaders(points: QdrantPoint[]): Promise<Map<string, string>> {
  const headerIds = new Set<string>();
  for (const p of points) {
    const payload = p.payload as Record<string, unknown> | undefined;
    const hid = payload?.headerChunkId as string | null;
    if (hid && payload?.chunkType !== "header") headerIds.add(hid);
  }

  const headerMap = new Map<string, string>();
  if (headerIds.size === 0) return headerMap;

  try {
    const headerPoints = await rawQdrant.retrieve(COLLECTION, {
      ids: [...headerIds],
      with_payload: true,
    });
    for (const hp of headerPoints) {
      const text = (hp.payload as Record<string, unknown>)?.text as string;
      if (text) headerMap.set(String(hp.id), text);
    }
  } catch {
    // Header expansion is best-effort
  }
  return headerMap;
}

export const searchCode = createTool({
  id: "searchCode",
  mcp: {
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
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
    compact: z
      .boolean()
      .default(true)
      .describe(
        "When true (default), returns minimal metadata (filePath, symbolName, lineRange, summary). " +
          "When false, returns full code chunks with classContext. Use compact for discovery, full for deep inspection.",
      ),
  }),

  execute: async (inputData) => {
    const { query, repo, language, layer, compact } = inputData;
    const t0 = Date.now();

    const conditions: Array<{ key: string; match: { value: string } }> = [];
    if (repo) conditions.push({ key: "repo", match: { value: repo } });
    if (language) conditions.push({ key: "language", match: { value: language } });
    if (layer) conditions.push({ key: "layer", match: { value: layer } });
    const filter = conditions.length > 0 ? { must: conditions } : undefined;

    try {
      const textToEmbed = [language, layer, query].filter(Boolean).join(" ");
      const denseVec = await embedText(textToEmbed);
      const tEmbed = Date.now();

      const resultLimit = compact ? 3 : 8;

      // Hybrid search: dense + BM25 prefetch with RRF fusion (Qdrant handles ranking)
      const rawResults = await rawQdrant.query(COLLECTION, {
        prefetch: [
          { query: denseVec, using: "dense", limit: 20, filter },
          { query: textToSparse(textToEmbed), using: "bm25", limit: 20, filter },
        ],
        query: { fusion: "rrf" },
        limit: resultLimit,
        with_payload: true,
      });
      const tSearch = Date.now();

      const points = rawResults.points as QdrantPoint[];

      if (points.length === 0) {
        logger.info(
          { query, embed: tEmbed - t0, search: tSearch - tEmbed },
          "searchCode: no results",
        );
        return {
          results: [],
          message:
            "No matching code found. Suggestions: " +
            (language || layer ? "try removing the language/layer filter. " : "") +
            "Try searchStandards for conventions or getPattern for code templates.",
        };
      }

      if (compact) {
        const results = points.map(mapPointToCompact);
        logger.info(
          { query, embed: tEmbed - t0, search: tSearch - tEmbed, total: Date.now() - t0 },
          "searchCode timing (ms)",
        );
        return { results };
      }

      const headerMap = await fetchHeaders(points);
      const tHeaders = Date.now();

      const results = points.map((p) => mapPointToFull(p, headerMap));

      logger.info(
        {
          query,
          embed: tEmbed - t0,
          search: tSearch - tEmbed,
          headers: tHeaders - tSearch,
          total: Date.now() - t0,
        },
        "searchCode timing (ms)",
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
