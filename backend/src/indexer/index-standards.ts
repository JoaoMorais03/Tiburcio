// indexer/index-standards.ts — Core logic for indexing markdown standards into Qdrant.

import { readFile } from "node:fs/promises";
import { basename, dirname, relative } from "node:path";
import { MDocument } from "@mastra/rag";

import { logger } from "../config/logger.js";
import { ensureCollection, qdrant } from "../mastra/infra.js";
import { embedTexts, toUUID } from "./embed.js";
import { findMarkdownFiles } from "./fs.js";

const COLLECTION = "standards";

function extractMetadata(content: string, filePath: string, baseDir: string) {
  const titleMatch = content.match(/^#\s+(.+)$/m) || content.match(/^##\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : basename(filePath, ".md");
  const relPath = relative(baseDir, filePath);
  const category = dirname(relPath).split("/")[0] || "general";
  const tagsMatch = content.match(/^tags:\s*(.+)$/im);
  const tags = tagsMatch ? tagsMatch[1].split(",").map((t) => t.trim()) : [];
  return { title, category, tags };
}

function chunkId(relPath: string, index: number): string {
  return toUUID(`${COLLECTION}:${relPath}:${index}`);
}

export async function indexStandards(
  standardsDir: string,
): Promise<{ files: number; chunks: number }> {
  const files = await findMarkdownFiles(standardsDir);
  if (files.length === 0) return { files: 0, chunks: 0 };

  await ensureCollection(COLLECTION);
  let totalChunks = 0;

  for (const filePath of files) {
    const content = await readFile(filePath, "utf-8");
    const meta = extractMetadata(content, filePath, standardsDir);
    const relPath = relative(standardsDir, filePath);

    const doc = MDocument.fromText(content);
    const chunks = await doc.chunk({
      strategy: "recursive",
      maxSize: 1000,
      overlap: 100,
    });
    if (chunks.length === 0) continue;

    const embeddings = await embedTexts(chunks.map((c) => c.text));

    await qdrant.upsert({
      indexName: COLLECTION,
      vectors: embeddings,
      ids: chunks.map((_, i) => chunkId(relPath, i)),
      metadata: chunks.map((c) => ({
        text: c.text,
        title: meta.title,
        category: meta.category,
        tags: meta.tags,
        sourceFile: relPath,
      })),
    });

    totalChunks += chunks.length;
    logger.info({ file: relPath, chunks: chunks.length }, "Indexed standards file");
  }

  logger.info({ files: files.length, totalChunks }, "Standards indexing complete");
  return { files: files.length, chunks: totalChunks };
}
