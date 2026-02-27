// indexer/embed.ts — Embedding utilities (OpenRouter text-embedding-3-small via AI SDK).

import { createHash } from "node:crypto";
import { embed, embedMany } from "ai";

import { env } from "../config/env.js";
import { openrouter } from "../mastra/infra.js";
import { redactSecrets } from "./redact.js";

const embeddingModel = openrouter.textEmbeddingModel(env.EMBEDDING_MODEL, {
  provider: {
    only: [env.EMBEDDING_PROVIDER],
  },
});

/** Convert an arbitrary string into a deterministic UUID (v5-style) for Qdrant point IDs. */
export function toUUID(input: string): string {
  const hex = createHash("sha256").update(input).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function embedText(text: string): Promise<number[]> {
  const redacted = redactSecrets(text);
  const { embedding } = await embed({
    model: embeddingModel,
    value: redacted,
    abortSignal: AbortSignal.timeout(60_000),
  });
  return embedding;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const redacted = texts.map((text) => redactSecrets(text));
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: redacted,
    abortSignal: AbortSignal.timeout(60_000),
  });
  return embeddings;
}
