// mastra/infra.ts — Shared infrastructure singletons.
// Single source of truth for Qdrant clients, LLM models, and embedding models.
// MODEL_PROVIDER switches between local Ollama and cloud OpenRouter.
//
// Two Qdrant clients:
//   qdrant  — Mastra QdrantVector wrapper (simple upsert/query/delete)
//   rawQdrant — @qdrant/js-client-rest for sparse vectors & hybrid Query API

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { EmbeddingModelV3, LanguageModelV3 } from "@ai-sdk/provider";
import { QdrantVector } from "@mastra/qdrant";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { QdrantClient } from "@qdrant/js-client-rest";

import { env } from "../config/env.js";

// --- Qdrant ---

export const qdrant = new QdrantVector({
  url: env.QDRANT_URL,
  id: "qdrant",
});

/** Raw Qdrant client for sparse vectors and the Query API (prefetch + RRF). */
export const rawQdrant = new QdrantClient({ url: env.QDRANT_URL });

// --- Model Provider ---
// Ollama exposes an OpenAI-compatible API at /v1, so we use @ai-sdk/openai-compatible.

function createChatModel() {
  if (env.MODEL_PROVIDER === "ollama") {
    const ollama = createOpenAICompatible({ name: "ollama", baseURL: `${env.OLLAMA_BASE_URL}/v1` });
    return ollama.languageModel(env.OLLAMA_CHAT_MODEL);
  }
  const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY as string });
  return openrouter.chat(env.OPENROUTER_MODEL, {
    provider: { only: [env.OPENROUTER_PROVIDER] },
  });
}

function createEmbeddingModel() {
  if (env.MODEL_PROVIDER === "ollama") {
    const ollama = createOpenAICompatible({ name: "ollama", baseURL: `${env.OLLAMA_BASE_URL}/v1` });
    return ollama.textEmbeddingModel(env.OLLAMA_EMBEDDING_MODEL);
  }
  const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY as string });
  return openrouter.textEmbeddingModel(env.EMBEDDING_MODEL, {
    provider: { only: [env.EMBEDDING_PROVIDER] },
  });
}

/** Chat/completion model for agents and contextualization. */
export const chatModel: LanguageModelV3 = createChatModel() as LanguageModelV3;

/** Text embedding model for vector indexing and search. */
export const embeddingModel: EmbeddingModelV3 = createEmbeddingModel() as EmbeddingModelV3;

// --- Collections ---

/**
 * Create a Qdrant collection if it doesn't already exist.
 * Uses EMBEDDING_DIMENSIONS from env. When `sparse` is true, creates with
 * both dense ("dense") and sparse ("bm25") vector spaces.
 */
export async function ensureCollection(
  name: string,
  dimensions = env.EMBEDDING_DIMENSIONS as number,
  sparse = false,
): Promise<void> {
  try {
    if (sparse) {
      await rawQdrant.createCollection(name, {
        vectors: { dense: { size: dimensions, distance: "Cosine" } },
        sparse_vectors: { bm25: { modifier: "idf" } },
      });
    } else {
      await qdrant.createIndex({
        indexName: name,
        dimension: dimensions,
        metric: "cosine",
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("already exists")) throw e;
  }
}
