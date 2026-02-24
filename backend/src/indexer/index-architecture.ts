// indexer/index-architecture.ts — Core logic for indexing architecture + schema docs into Qdrant.

import { readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { MDocument } from "@mastra/rag";

import { logger } from "../config/logger.js";
import { ensureCollection, qdrant } from "../mastra/infra.js";
import { embedTexts, toUUID } from "./embed.js";
import { findMarkdownFiles } from "./fs.js";

function extractField(content: string, field: string): string | null {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : null;
}

function extractListField(content: string, field: string): string[] {
  const value = extractField(content, field);
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractTitle(content: string, filePath: string): string {
  const match = content.match(/^#\s+(.+)$/m) || content.match(/^##\s+(.+)$/m);
  return match ? match[1].trim() : basename(filePath, ".md");
}

function chunkId(collection: string, relPath: string, index: number): string {
  return toUUID(`${collection}:${relPath}:${index}`);
}

async function indexArchitectureDocs(standardsDir: string): Promise<number> {
  const archDir = join(standardsDir, "architecture");
  const files = await findMarkdownFiles(archDir);
  if (files.length === 0) return 0;

  await ensureCollection("architecture");
  let totalChunks = 0;

  for (const filePath of files) {
    const content = await readFile(filePath, "utf-8");
    const title = extractTitle(content, filePath);
    const area = extractField(content, "area") || "overview";
    const keyFiles = extractListField(content, "keyFiles");
    const relPath = relative(standardsDir, filePath);

    const doc = MDocument.fromText(content);
    const chunks = await doc.chunk({
      strategy: "recursive",
      maxSize: 800,
      overlap: 100,
    });
    if (chunks.length === 0) continue;

    const embeddings = await embedTexts(chunks.map((c) => c.text));

    await qdrant.upsert({
      indexName: "architecture",
      vectors: embeddings,
      ids: chunks.map((_, i) => chunkId("architecture", relPath, i)),
      metadata: chunks.map((c) => ({
        text: c.text,
        title,
        area,
        keyFiles,
        sourceFile: relPath,
      })),
    });

    totalChunks += chunks.length;
    logger.info({ file: relPath, chunks: chunks.length }, "Indexed architecture file");
  }
  return totalChunks;
}

async function indexSchemaDocs(standardsDir: string): Promise<number> {
  const schemaDir = join(standardsDir, "database", "schemas");
  const files = await findMarkdownFiles(schemaDir);
  if (files.length === 0) return 0;

  await ensureCollection("schemas");
  let totalChunks = 0;

  for (const filePath of files) {
    const content = await readFile(filePath, "utf-8");
    const tableName = extractField(content, "table") || basename(filePath, ".md");
    const description = extractField(content, "description") || "";
    const relations = extractListField(content, "relations");
    const indexes = extractListField(content, "indexes");
    const relPath = relative(standardsDir, filePath);

    const doc = MDocument.fromText(content);
    const chunks = await doc.chunk({
      strategy: "recursive",
      maxSize: 600,
      overlap: 80,
    });
    if (chunks.length === 0) continue;

    const embeddings = await embedTexts(chunks.map((c) => c.text));

    await qdrant.upsert({
      indexName: "schemas",
      vectors: embeddings,
      ids: chunks.map((_, i) => chunkId("schemas", relPath, i)),
      metadata: chunks.map((c) => ({
        text: c.text,
        tableName,
        description,
        relations,
        indexes,
        sourceFile: relPath,
      })),
    });

    totalChunks += chunks.length;
    logger.info({ file: relPath, chunks: chunks.length }, "Indexed schema file");
  }
  return totalChunks;
}

export async function indexArchitecture(
  standardsDir: string,
): Promise<{ archChunks: number; schemaChunks: number }> {
  const archChunks = await indexArchitectureDocs(standardsDir);
  const schemaChunks = await indexSchemaDocs(standardsDir);
  logger.info({ archChunks, schemaChunks }, "Architecture indexing complete");
  return { archChunks, schemaChunks };
}
