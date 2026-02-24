// indexer/index-codebase.ts — Core logic for indexing the target codebase into Qdrant.

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import { logger } from "../config/logger.js";
import { redis } from "../config/redis.js";
import { ensureCollection, qdrant } from "../mastra/infra.js";
import { chunkFile } from "./chunker.js";
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

function chunkId(filePath: string, startLine: number): string {
  return toUUID(`${COLLECTION}:${filePath}:${startLine}`);
}

export async function indexCodebase(
  codebasePath: string,
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

  const allChunks: Array<{
    content: string;
    filePath: string;
    language: string;
    layer: string;
    startLine: number;
    endLine: number;
  }> = [];

  for (const filePath of sourceFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      const relPath = relative(codebasePath, filePath);
      const chunks = chunkFile(content, relPath);
      if (chunks.length > 0) allChunks.push(...chunks);
    } catch {
      // skip unreadable files
    }
  }

  // Drop and recreate collection to purge stale vectors from deleted/renamed files.
  // The nightly incremental reindex handles partial updates separately.
  try {
    await qdrant.deleteIndex({ indexName: COLLECTION });
    logger.info("Dropped existing code-chunks collection for clean reindex");
  } catch {
    // Collection may not exist yet — that's fine
  }
  await ensureCollection(COLLECTION);
  logger.info(
    { files: sourceFiles.length, chunks: allChunks.length },
    "Starting codebase indexing",
  );

  for (let i = 0; i < allChunks.length; i += UPSERT_BATCH_SIZE) {
    const batch = allChunks.slice(i, i + UPSERT_BATCH_SIZE);

    const textsToEmbed = batch.map(
      (chunk) => `${chunk.language} ${chunk.layer} ${chunk.filePath}\n\n${chunk.content}`,
    );
    const embeddings = await embedTexts(textsToEmbed);

    await qdrant.upsert({
      indexName: COLLECTION,
      vectors: embeddings,
      ids: batch.map((chunk) => chunkId(chunk.filePath, chunk.startLine)),
      metadata: batch.map((chunk) => ({
        text: redactSecrets(chunk.content),
        filePath: chunk.filePath,
        language: chunk.language,
        layer: chunk.layer,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
      })),
    });

    logger.info(
      { batch: Math.floor(i / UPSERT_BATCH_SIZE) + 1, chunks: batch.length },
      "Indexed codebase batch",
    );
  }

  // Store the current HEAD SHA so the nightly incremental reindex knows
  // where to diff from. Without this, the first nightly after a full index
  // would fall back to "last 24 hours" and miss the baseline.
  try {
    const headSha = await getHeadSha(codebasePath);
    await redis.set("tiburcio:last-indexed-sha", headSha);
    logger.info({ headSha }, "Stored HEAD SHA for incremental reindex baseline");
  } catch {
    // Not a git repo or git not available — nightly will use 24h fallback
  }

  logger.info(
    { files: sourceFiles.length, totalChunks: allChunks.length },
    "Codebase indexing complete",
  );
  return { files: sourceFiles.length, chunks: allChunks.length };
}
