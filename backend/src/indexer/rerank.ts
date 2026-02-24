// indexer/rerank.ts — Rerank Qdrant results using Mastra's LLM-based scorer.

import type { MastraLanguageModel } from "@mastra/core/agent";
import type { QueryResult } from "@mastra/core/vector";
import { rerank } from "@mastra/rag";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { openrouter } from "../mastra/infra.js";

/** Rerank vector search results using the agent LLM for semantic scoring. */
export async function rerankResults(
  query: string,
  results: QueryResult[],
  topK: number,
): Promise<QueryResult[]> {
  if (results.length <= 1) return results;

  try {
    const model = openrouter.chat(env.OPENROUTER_MODEL, {
      provider: { only: [env.OPENROUTER_PROVIDER] },
    });

    // Cast needed: OpenRouter SDK types lag behind Mastra's LanguageModelV3 interface
    const reranked = await rerank(results, query, model as unknown as MastraLanguageModel, {
      weights: { semantic: 0.5, vector: 0.3, position: 0.2 },
      topK,
    });

    return reranked.map((r) => r.result);
  } catch (err) {
    logger.warn({ err }, "Reranking failed, falling back to vector order");
    return results.slice(0, topK);
  }
}
