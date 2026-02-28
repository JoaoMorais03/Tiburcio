// indexer/index-codebase.ts — Core logic for indexing the target codebase into Qdrant.
// v1.2: Per-file pipeline with p-limit concurrency — chunk, contextualize, embed, upsert per file.
// Data appears in Qdrant immediately. Crash-recoverable. ~3x faster than sequential.

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import pLimit from "p-limit";

import { logger } from "../config/logger.js";
import { redis } from "../config/redis.js";
import { ensureCollection, rawQdrant } from "../mastra/infra.js";
import { textToSparse } from "./bm25.js";
import { chunkFile } from "./chunker.js";
import { contextualizeChunks } from "./contextualize.js";
import { embedTexts, toUUID } from "./embed.js";
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

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "target",
  "build",
  "dist",
  ".idea",
  ".mvn",
  ".vscode",
  ".claude",
  "cicd",
  "docs",
  "test",
  "__tests__",
  "cypress",
]);
const SOURCE_EXTENSIONS = new Set([".java", ".vue", ".ts", ".tsx", ".sql"]);

// Blocked file patterns to prevent secret leaks
const BLOCKED_FILE_PATTERNS = [
  /\.config\.(ts|js|mjs|cjs)$/,
  /\.env(\..+)?$/,
  /docker-compose.*\.ya?ml$/,
  /Dockerfile/,
  /secrets?\.(ts|js|json|ya?ml)$/,
  /credentials?\.(ts|js|json)$/,
];

// Blocked path segments to skip risky directories
const BLOCKED_PATH_SEGMENTS = new Set([
  "resources",
  "environments",
  "env",
  "config",
  ".github",
  ".gitlab",
  "terraform",
  "helm",
  "k8s",
  "kubernetes",
  "ansible",
]);

function isFileBlocked(filename: string, relativePath: string): boolean {
  if (BLOCKED_FILE_PATTERNS.some((pattern) => pattern.test(filename))) return true;
  return relativePath.split("/").some((part) => BLOCKED_PATH_SEGMENTS.has(part));
}

async function loadTibignorePatterns(codebasePath: string): Promise<RegExp[]> {
  try {
    const tibignorePath = join(codebasePath, ".tibignore");
    const content = await readFile(tibignorePath, "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((pattern) => {
        // Convert simple glob patterns to regex
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        const regex = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
        return new RegExp(`^${regex}$`);
      });
  } catch {
    return [];
  }
}

async function findSourceFiles(
  dir: string,
  codebasePath: string,
  tibignorePatterns: RegExp[],
): Promise<string[]> {
  const files: string[] = [];
  let entries: import("node:fs").Dirent[] | undefined;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    const relPath = relative(codebasePath, fullPath);

    if (tibignorePatterns.some((pattern) => pattern.test(relPath))) {
      logger.debug({ path: relPath }, "Skipped by .tibignore");
      continue;
    }

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await findSourceFiles(fullPath, codebasePath, tibignorePatterns)));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      if (isFileBlocked(entry.name, relPath)) {
        logger.debug({ path: relPath }, "Skipped blocked file");
        continue;
      }
      files.push(fullPath);
    }
  }
  return files;
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
): Promise<{ chunks: number; contextSkipped: number }> {
  const content = await readFile(filePath, "utf-8");
  const relPath = relative(codebasePath, filePath);

  logger.info({ file: relPath, progress: `${fileIndex + 1}/${totalFiles}` }, "Indexing file");

  const chunks = chunkFile(content, relPath);
  if (chunks.length === 0) return { chunks: 0, contextSkipped: 0 };

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
  const textsToEmbed = chunks.map((chunk, idx) => {
    const prefix = `${chunk.language} ${chunk.layer} ${chunk.filePath}`;
    return contexts[idx]
      ? `${contexts[idx]}\n\n${prefix}\n\n${chunk.content}`
      : `${prefix}\n\n${chunk.content}`;
  });
  const embeddings = await withRetry(() => embedTexts(textsToEmbed), "Embedding", relPath);

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
      },
    };
  });

  await withRetry(() => rawQdrant.upsert(COLLECTION, { wait: true, points }), "Upsert", relPath);
  return { chunks: chunks.length, contextSkipped };
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

  const sourceFiles = await findSourceFiles(codebasePath, codebasePath, tibignorePatterns);
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

  // Purge stale vectors for this repo before re-indexing.
  // Delete-by-filter (not drop) so other repos are untouched.
  try {
    await rawQdrant.delete(COLLECTION, {
      wait: true,
      filter: { must: [{ key: "repo", match: { value: repoName } }] },
    });
    logger.info({ repo: repoName }, "Purged stale vectors for repo");
  } catch {
    // Collection was just created — nothing to delete
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
          return { chunks: 0, contextSkipped: 0 };
        }
      }),
    ),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      totalChunks += result.value.chunks;
      totalContextSkipped += result.value.contextSkipped;
    }
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
