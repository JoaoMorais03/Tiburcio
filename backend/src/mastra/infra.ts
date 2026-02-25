// mastra/infra.ts — Shared infrastructure singletons.
// Keeps Qdrant and OpenRouter instances in one place so tools, agents,
// and indexers all share the same clients.
//
// Two Qdrant clients:
//   qdrant  — Mastra QdrantVector wrapper (simple upsert/query/delete)
//   rawQdrant — @qdrant/js-client-rest for sparse vectors & hybrid Query API

import { QdrantVector } from "@mastra/qdrant";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { QdrantClient } from "@qdrant/js-client-rest";

import { env } from "../config/env.js";

export const qdrant = new QdrantVector({
  url: env.QDRANT_URL,
  id: "qdrant",
});

/** Raw Qdrant client for sparse vectors and the Query API (prefetch + RRF). */
export const rawQdrant = new QdrantClient({ url: env.QDRANT_URL });

export const openrouter = createOpenRouter({
  apiKey: env.OPENROUTER_API_KEY,
});

/**
 * Create a Qdrant collection if it doesn't already exist.
 * When `sparse` is true, creates with both dense ("dense") and sparse ("bm25") vector spaces.
 */
export async function ensureCollection(
  name: string,
  dimensions = 4096,
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
