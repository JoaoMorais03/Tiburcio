// mastra/infra.ts — Shared infrastructure singletons.
// Single source of truth for Qdrant client and collection management.

import { QdrantClient } from "@qdrant/js-client-rest";

import { env } from "../config/env.js";

// --- Qdrant ---

/** Qdrant client for all vector operations (upsert, search, Query API, sparse vectors). */
export const rawQdrant = new QdrantClient({ url: env.QDRANT_URL });

// --- Collections ---

/** List all Qdrant collection names. */
export async function listCollections(): Promise<string[]> {
  const { collections } = await rawQdrant.getCollections();
  return collections.map((c) => c.name);
}

/** Delete a Qdrant collection by name. */
export async function deleteCollection(name: string): Promise<void> {
  await rawQdrant.deleteCollection(name);
}

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
      await rawQdrant.createCollection(name, {
        vectors: { size: dimensions, distance: "Cosine" },
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("already exists") && !msg.includes("Conflict")) throw e;
  }
}
