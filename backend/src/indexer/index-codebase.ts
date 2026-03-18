// indexer/index-codebase.ts — Core logic for indexing the target codebase into Qdrant.
// v1.2: Per-file pipeline with p-limit concurrency — chunk, contextualize, embed, upsert per file.
// Data appears in Qdrant immediately. Crash-recoverable. ~3x faster than sequential.

import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";

import pLimit from "p-limit";

import { logger } from "../config/logger.js";
import { redis } from "../config/redis.js";
import { ensureCollection, rawQdrant } from "../mastra/infra.js";
import { textToSparse } from "./bm25.js";
import { chunkFile } from "./chunker.js";
import { contextualizeChunks } from "./contextualize.js";
import { contentHash, embedTexts, enrichChunkForEmbedding, toUUID } from "./embed.js";
import { findSourceFiles, loadTibignorePatterns } from "./fs.js";
import { getHeadSha } from "./git-diff.js";
import { redactSecrets } from "./redact.js";

const COLLECTION = "code-chunks";
const FILE_CONCURRENCY = 3;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;

async function withRetry<T>(fn: () => Promise<T>, label: string, filePath: string): Promise<T> {
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === RETRY_ATTEMPTS) throw err;
      const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
      logger.warn(
        { err, filePath, attempt, maxAttempts: RETRY_ATTEMPTS, retryInMs: delay },
        `${label} failed, retrying`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("unreachable");
}

function chunkId(repoName: string, filePath: string, startLine: number): string {
  return toUUID(`${repoName}:${filePath}:${startLine}`);
}

/**
 * Process a single file: chunk → contextualize → embed → upsert.
 * Self-contained pipeline — each file's data is persisted immediately.
 */
async function processFile(
  filePath: string,
  codebasePath: string,
  repoName: string,
  fileIndex: number,
  totalFiles: number,
): Promise<{ chunks: number; contextSkipped: number; chunkIds: string[] }> {
  const content = await readFile(filePath, "utf-8");
  const relPath = relative(codebasePath, filePath);

  logger.info({ file: relPath, progress: `${fileIndex + 1}/${totalFiles}` }, "Indexing file");

  const chunks = chunkFile(content, relPath);
  if (chunks.length === 0) return { chunks: 0, contextSkipped: 0, chunkIds: [] };

  // Link each chunk to its file's header chunk
  const headerChunk = chunks.find((c) => c.chunkType === "header");
  const headerChunkUUID = headerChunk ? chunkId(repoName, relPath, headerChunk.startLine) : null;
  for (const chunk of chunks) {
    chunk.headerChunkId = chunk.chunkType === "header" ? null : headerChunkUUID;
  }

  // Contextualize — skip header chunks (self-documenting) and single-chunk small files
  // (the chunk IS the full file, so embedding already captures all context).
  const isSmallSingleChunk = chunks.length === 1 && content.length <= 3000;
  let contexts: string[];
  let contextSkipped = 0;

  if (isSmallSingleChunk) {
    contexts = [""];
    contextSkipped = 1;
  } else {
    try {
      // Pass empty content for header chunks so contextualizeChunk returns "" immediately
      const chunksForContext = chunks.map((c) => (c.chunkType === "header" ? { content: "" } : c));
      contexts = await contextualizeChunks(content, chunksForContext, relPath, chunks[0].language);
    } catch (err) {
      logger.warn({ err, filePath: relPath }, "Contextualization failed, using empty contexts");
      contexts = chunks.map(() => "");
    }
    contextSkipped = chunks.filter((c) => c.chunkType === "header").length;
  }

  // Embed all chunks for this file in one batch call
  const enrichedTexts = chunks.map((chunk, idx) =>
    enrichChunkForEmbedding(chunk, contexts[idx] || undefined),
  );
  const hashes = enrichedTexts.map(contentHash);

  // Batch-retrieve existing payloads + dense vectors to skip re-embedding unchanged chunks
  const chunkIds = chunks.map((c) => chunkId(repoName, c.filePath, c.startLine));
  let existing: Array<{
    id: string | number;
    payload?: Record<string, unknown> | null;
    vectors?: Record<string, unknown> | null;
  }> = [];
  try {
    existing = await rawQdrant.retrieve(COLLECTION, {
      ids: chunkIds,
      with_payload: ["contentHash"],
      with_vector: ["dense"],
    });
  } catch {
    // Hash cache unavailable — embed all chunks
  }
  const existingMap = new Map(existing.map((p) => [String(p.id), p]));

  const toEmbedIdxs: number[] = [];
  const embeddings: number[][] = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    const ex = existingMap.get(chunkIds[i]);
    const existingDense = (ex?.vectors as Record<string, unknown> | undefined)?.dense as
      | number[]
      | undefined;
    if (ex?.payload?.contentHash === hashes[i] && existingDense) {
      embeddings[i] = existingDense;
    } else {
      toEmbedIdxs.push(i);
    }
  }

  if (toEmbedIdxs.length < chunks.length) {
    logger.debug(
      { file: relPath, skipped: chunks.length - toEmbedIdxs.length, total: chunks.length },
      "Hash cache hit — skipping unchanged chunks",
    );
  }

  if (toEmbedIdxs.length > 0) {
    const newEmbeds = await withRetry(
      () => embedTexts(toEmbedIdxs.map((i) => enrichedTexts[i])),
      "Embedding",
      relPath,
    );
    for (let j = 0; j < toEmbedIdxs.length; j++) embeddings[toEmbedIdxs[j]] = newEmbeds[j];
  }

  // Build points with dense + sparse vectors and upsert immediately
  const points = chunks.map((chunk, idx) => {
    const sparseText = [
      chunk.content,
      chunk.symbolName,
      chunk.parentSymbol,
      chunk.annotations.join(" "),
    ]
      .filter(Boolean)
      .join(" ");

    return {
      id: chunkId(repoName, chunk.filePath, chunk.startLine),
      vector: {
        dense: embeddings[idx],
        bm25: textToSparse(sparseText),
      },
      payload: {
        repo: repoName,
        text: redactSecrets(chunk.content),
        context: contexts[idx],
        filePath: chunk.filePath,
        language: chunk.language,
        layer: chunk.layer,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        symbolName: chunk.symbolName,
        parentSymbol: chunk.parentSymbol,
        chunkType: chunk.chunkType,
        annotations: chunk.annotations,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunk.totalChunks,
        headerChunkId: chunk.headerChunkId,
        contentHash: hashes[idx],
        indexedAt: new Date().toISOString(),
      },
    };
  });

  await withRetry(() => rawQdrant.upsert(COLLECTION, { wait: true, points }), "Upsert", relPath);
  return { chunks: chunks.length, contextSkipped, chunkIds };
}

export async function indexCodebase(
  codebasePath: string,
  repoName: string,
): Promise<{ files: number; chunks: number }> {
  try {
    await stat(codebasePath);
  } catch {
    throw new Error(`Codebase path not found: ${codebasePath}`);
  }

  const tibignorePatterns = await loadTibignorePatterns(codebasePath);
  if (tibignorePatterns.length > 0) {
    logger.info({ patterns: tibignorePatterns.length }, "Loaded .tibignore patterns");
  }

  const sourceFiles = await findSourceFiles(codebasePath, codebasePath, tibignorePatterns, {
    checkBlocked: true,
  });
  if (sourceFiles.length === 0) return { files: 0, chunks: 0 };

  // Create collection FIRST so upserts work immediately
  await ensureCollection(COLLECTION, undefined, true);
  try {
    await rawQdrant.createPayloadIndex(COLLECTION, {
      field_name: "repo",
      field_schema: "keyword",
      wait: true,
    });
  } catch {
    // Index already exists — fine
  }

  logger.info(
    { repo: repoName, files: sourceFiles.length, concurrency: FILE_CONCURRENCY },
    "Starting codebase indexing",
  );

  // Process files with bounded concurrency — each file is an independent
  // chunk → contextualize → embed → upsert pipeline
  const limit = pLimit(FILE_CONCURRENCY);
  let totalChunks = 0;
  let totalContextSkipped = 0;

  const results = await Promise.allSettled(
    sourceFiles.map((filePath, idx) =>
      limit(async () => {
        try {
          return await processFile(filePath, codebasePath, repoName, idx, sourceFiles.length);
        } catch (err) {
          logger.warn(
            { path: filePath, err },
            "Skipped file during indexing after retries exhausted",
          );
          return { chunks: 0, contextSkipped: 0, chunkIds: [] };
        }
      }),
    ),
  );

  const allCurrentIds = new Set<string>();
  for (const result of results) {
    if (result.status === "fulfilled") {
      totalChunks += result.value.chunks;
      totalContextSkipped += result.value.contextSkipped;
      for (const id of result.value.chunkIds) allCurrentIds.add(id);
    }
  }

  // Delete orphan vectors: chunks from a previous index that no longer exist
  try {
    let nextOffset: string | number | null = null;
    do {
      const page = await rawQdrant.scroll(COLLECTION, {
        filter: { must: [{ key: "repo", match: { value: repoName } }] },
        limit: 500,
        offset: nextOffset ?? undefined,
        with_payload: false,
        with_vector: false,
      });
      const pts = page.points as Array<{ id: string | number }>;
      const orphanIds = pts.map((p) => String(p.id)).filter((id) => !allCurrentIds.has(id));
      if (orphanIds.length > 0) {
        await rawQdrant.delete(COLLECTION, { wait: true, points: orphanIds });
        logger.info({ count: orphanIds.length, repo: repoName }, "Deleted orphan vectors");
      }
      nextOffset =
        (page as unknown as { next_page_offset?: string | number | null }).next_page_offset ?? null;
    } while (nextOffset != null);
  } catch {
    // Not critical — orphans will be cleaned on next index
  }

  // Store the current HEAD SHA per repo so the nightly incremental reindex
  // knows where to diff from.
  try {
    const headSha = await getHeadSha(codebasePath);
    await redis.set(`tiburcio:codebase-head:${repoName}`, headSha);
    logger.info({ repo: repoName, headSha }, "Stored HEAD SHA for incremental reindex baseline");
  } catch {
    // Not a git repo or git not available — nightly will use 24h fallback
  }

  if (totalContextSkipped > 0) {
    logger.info(
      { contextSkipped: totalContextSkipped, totalChunks },
      "Skipped contextualization for header/small-file chunks",
    );
  }

  logger.info(
    { repo: repoName, files: sourceFiles.length, totalChunks },
    "Codebase indexing complete",
  );
  return { files: sourceFiles.length, chunks: totalChunks };
}
