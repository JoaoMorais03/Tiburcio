// indexer/embed.ts — Embedding utilities (provider-agnostic via AI SDK).
// Model configured via MODEL_PROVIDER env var in lib/model-provider.ts.

import { createHash } from "node:crypto";
import { embed, embedMany } from "ai";

import { getLangfuse } from "../lib/langfuse.js";
import { getEmbeddingModel } from "../lib/model-provider.js";
import type { ASTChunk } from "./ast-chunker.js";
import { redactSecrets } from "./redact.js";

/** Convert an arbitrary string into a deterministic UUID (v5-style) for Qdrant point IDs. */
export function toUUID(input: string): string {
  const hex = createHash("sha256").update(input).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Build enriched embed text for a code chunk.
 * Prepends structured metadata so the embedding model understands
 * what the chunk represents before seeing the code.
 * The ORIGINAL chunk.content is stored in Qdrant payload — only the enriched text is embedded.
 */
export function enrichChunkForEmbedding(chunk: ASTChunk, context?: string): string {
  const parts = [
    chunk.filePath && `File: ${chunk.filePath}`,
    chunk.language && `Language: ${chunk.language}`,
    chunk.layer && `Layer: ${chunk.layer}`,
    chunk.symbolName && `Symbol: ${chunk.symbolName}`,
    chunk.parentSymbol && `Parent: ${chunk.parentSymbol}`,
  ]
    .filter(Boolean)
    .join(" | ");

  const prefix = parts ? `[${parts}]` : "";
  const withContext = context ? `${context}\n\n${prefix}` : prefix;
  return withContext ? `${withContext}\n\n${chunk.content}` : chunk.content;
}

/** SHA-256 of the given text, hex-encoded. Used for embedding cache (contentHash in Qdrant payload). */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function embedText(text: string): Promise<number[]> {
  const redacted = redactSecrets(text);
  const langfuse = getLangfuse();
  const generation = langfuse?.generation({
    name: "embedText",
    model: "embedding",
    input: redacted.slice(0, 200),
  });
  const { embedding } = await embed({
    model: getEmbeddingModel(),
    value: redacted,
    abortSignal: AbortSignal.timeout(60_000),
  });
  try { generation?.end({ output: { dimensions: embedding.length } }); } catch { /* observability must never crash embeddings */ }
  return embedding;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const redacted = texts.map((text) => redactSecrets(text));
  const langfuse = getLangfuse();
  const generation = langfuse?.generation({
    name: "embedTexts",
    model: "embedding",
    input: { count: redacted.length },
  });
  const { embeddings } = await embedMany({
    model: getEmbeddingModel(),
    values: redacted,
    abortSignal: AbortSignal.timeout(60_000),
  });
  try { generation?.end({ output: { count: embeddings.length, dimensions: embeddings[0]?.length } }); } catch { /* observability must never crash embeddings */ }
  return embeddings;
}
