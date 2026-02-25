// indexer/index-codebase.ts — Core logic for indexing the target codebase into Qdrant.
// v1.1: AST chunking + contextual retrieval + header metadata + BM25 sparse vectors.

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

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
const UPSERT_BATCH_SIZE = 50;

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

  // --- Chunk all files + generate contextual descriptions ---

  interface IndexChunk {
    content: string;
    context: string;
    filePath: string;
    language: string;
    layer: string;
    startLine: number;
    endLine: number;
    symbolName: string | null;
    parentSymbol: string | null;
    chunkType: string;
    annotations: string[];
    chunkIndex: number;
    totalChunks: number;
    headerChunkId: string | null;
  }

  const allChunks: IndexChunk[] = [];
  let contextFailures = 0;

  for (const filePath of sourceFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      const relPath = relative(codebasePath, filePath);
      const chunks = chunkFile(content, relPath);
      if (chunks.length === 0) continue;

      // Phase 3: Link each chunk to its file's header chunk
      const headerChunk = chunks.find((c) => c.chunkType === "header");
      const headerChunkUUID = headerChunk
        ? chunkId(repoName, relPath, headerChunk.startLine)
        : null;
      for (const chunk of chunks) {
        chunk.headerChunkId = chunk.chunkType === "header" ? null : headerChunkUUID;
      }

      // Phase 2: Generate contextual descriptions for each chunk
      let contexts: string[];
      try {
        contexts = await contextualizeChunks(content, chunks, relPath, chunks[0].language);
      } catch (err) {
        logger.warn({ err, filePath: relPath }, "Contextualization failed, using empty contexts");
        contexts = chunks.map(() => "");
      }

      // Track empty contexts (LLM returned nothing or batch failed)
      contextFailures += contexts.filter((c) => c === "").length;

      for (let i = 0; i < chunks.length; i++) {
        allChunks.push({ ...chunks[i], context: contexts[i] });
      }
    } catch (err) {
      logger.debug({ path: filePath, err }, "Skipped unreadable file during indexing");
    }
  }

  // Ensure collection exists with sparse vector support, then purge this repo's
  // stale vectors. Delete-by-filter (not drop) so other repos are untouched.
  await ensureCollection(COLLECTION, 4096, true);
  try {
    await rawQdrant.createPayloadIndex(COLLECTION, {
      field_name: "repo",
      field_schema: "keyword",
      wait: true,
    });
  } catch {
    // Index already exists — fine
  }
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
    { files: sourceFiles.length, chunks: allChunks.length },
    "Starting codebase indexing",
  );

  // --- Embed and upsert in batches ---

  for (let i = 0; i < allChunks.length; i += UPSERT_BATCH_SIZE) {
    const batch = allChunks.slice(i, i + UPSERT_BATCH_SIZE);

    // Phase 2: Prepend context to embedding text for richer vectors
    const textsToEmbed = batch.map((chunk) => {
      const prefix = `${chunk.language} ${chunk.layer} ${chunk.filePath}`;
      return chunk.context
        ? `${chunk.context}\n\n${prefix}\n\n${chunk.content}`
        : `${prefix}\n\n${chunk.content}`;
    });
    const embeddings = await embedTexts(textsToEmbed);

    // Phase 5: Generate sparse BM25 vectors from raw content + symbol names
    const points = batch.map((chunk, idx) => {
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
          context: chunk.context,
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

    await rawQdrant.upsert(COLLECTION, { wait: true, points });

    logger.info(
      { batch: Math.floor(i / UPSERT_BATCH_SIZE) + 1, chunks: batch.length },
      "Indexed codebase batch",
    );
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

  if (contextFailures > 0) {
    logger.warn(
      { contextFailures, totalChunks: allChunks.length },
      "Some chunks indexed without contextual descriptions",
    );
  }

  logger.info(
    {
      repo: repoName,
      files: sourceFiles.length,
      totalChunks: allChunks.length,
    },
    "Codebase indexing complete",
  );
  return { files: sourceFiles.length, chunks: allChunks.length };
}
