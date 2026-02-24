// mastra/infra.ts — Shared infrastructure singletons.
// Keeps Qdrant and OpenRouter instances in one place so tools, agents,
// and indexers all share the same clients.

import { QdrantVector } from "@mastra/qdrant";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

import { env } from "../config/env.js";

export const qdrant = new QdrantVector({
  url: env.QDRANT_URL,
  id: "qdrant",
});

export const openrouter = createOpenRouter({
  apiKey: env.OPENROUTER_API_KEY,
});

/** Create a Qdrant collection if it doesn't already exist. */
export async function ensureCollection(name: string, dimensions = 1024): Promise<void> {
  try {
    await qdrant.createIndex({
      indexName: name,
      dimension: dimensions,
      metric: "cosine",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("already exists")) throw e;
  }
}
