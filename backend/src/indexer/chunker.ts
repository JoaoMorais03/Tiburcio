// indexer/chunker.ts — Smart code chunker that splits by language-aware boundaries.
// Java/TypeScript: tree-sitter AST parsing. Vue: SFC section split + AST for <script>.
// SQL: regex-based statement boundaries (works fine, no AST needed).
// Each chunk gets a layer tag inferred from the file path (service, controller, etc.).

import type { ASTChunk } from "./ast-chunker.js";
import { chunkJavaAST, chunkTypeScriptAST, chunkVueAST } from "./ast-chunker.js";

// Re-export the chunk type so consumers don't need to import from ast-chunker
export type { ASTChunk };

// --- Layer Inference ---

// First match wins — more specific patterns go first.
const LAYER_PATTERNS: Array<{ pattern: RegExp; layer: string }> = [
  // API project layers
  { pattern: /\/web\/controller\//, layer: "controller" },
  { pattern: /\/business\/.*\/impl\//, layer: "service" },
  { pattern: /\/business\//, layer: "service" },
  { pattern: /\/postgres\/data\/model\//, layer: "model" },
  { pattern: /\/postgres\/data\/repository\//, layer: "repository" },
  { pattern: /\/mysql\/data\//, layer: "model" },
  { pattern: /\/common\/dto\//, layer: "dto" },
  { pattern: /\/common\/exception\//, layer: "exception" },
  { pattern: /\/common\/configuration\//, layer: "config" },
  { pattern: /\/common\/constants\//, layer: "constants" },
  { pattern: /\/common\//, layer: "common" },
  { pattern: /\/config\//, layer: "config" },

  // Batch project layers
  { pattern: /\/jobs\//, layer: "batch" },
  { pattern: /\/listeners\//, layer: "listener" },
  { pattern: /\/repository\//, layer: "repository" },
  { pattern: /\/dto\//, layer: "dto" },

  // UI project layers
  { pattern: /\/stores\//, layer: "store" },
  { pattern: /\/components\//, layer: "component" },
  { pattern: /\/pages\//, layer: "page" },
  { pattern: /\/composables\//, layer: "composable" },
  { pattern: /\/federations\//, layer: "federation" },
  { pattern: /\/boot\//, layer: "boot" },
  { pattern: /\/router\//, layer: "router" },
  { pattern: /\/constants\//, layer: "constants" },
];

export function inferLayer(filePath: string): string {
  for (const { pattern, layer } of LAYER_PATTERNS) {
    if (pattern.test(filePath)) return layer;
  }
  return "other";
}

// --- Language Detection ---

export function detectLanguage(filePath: string): "java" | "typescript" | "vue" | "sql" | null {
  if (filePath.endsWith(".java")) return "java";
  if (filePath.endsWith(".vue")) return "vue";
  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return "typescript";
  if (filePath.endsWith(".sql")) return "sql";
  return null;
}

// --- SQL Chunking (regex — simple and works perfectly for DDL/DML) ---

const SQL_STATEMENT_REGEX =
  /^(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|BEGIN|COMMIT)\b/gim;

const MAX_CHUNK_SIZE = 3000;

function chunkSQL(content: string, filePath: string): ASTChunk[] {
  if (content.length <= MAX_CHUNK_SIZE) {
    return [
      {
        content,
        filePath,
        language: "sql",
        layer: "database",
        startLine: 1,
        endLine: content.split("\n").length,
        symbolName: null,
        parentSymbol: null,
        chunkType: "file",
        annotations: [],
        chunkIndex: 0,
        totalChunks: 1,
        headerChunkId: null,
      },
    ];
  }

  const lines = content.split("\n");
  const statementStarts: number[] = [];
  SQL_STATEMENT_REGEX.lastIndex = 0;

  for (
    let sqlMatch = SQL_STATEMENT_REGEX.exec(content);
    sqlMatch !== null;
    sqlMatch = SQL_STATEMENT_REGEX.exec(content)
  ) {
    const lineNum = content.substring(0, sqlMatch.index).split("\n").length;
    statementStarts.push(lineNum);
  }

  if (statementStarts.length <= 1) {
    return [
      {
        content,
        filePath,
        language: "sql",
        layer: "database",
        startLine: 1,
        endLine: lines.length,
        symbolName: null,
        parentSymbol: null,
        chunkType: "file",
        annotations: [],
        chunkIndex: 0,
        totalChunks: 1,
        headerChunkId: null,
      },
    ];
  }

  const chunks: ASTChunk[] = [];
  for (let i = 0; i < statementStarts.length; i++) {
    const start = statementStarts[i];
    const end = i < statementStarts.length - 1 ? statementStarts[i + 1] - 1 : lines.length;
    const stmtContent = lines.slice(start - 1, end).join("\n");

    if (stmtContent.trim().length > 0) {
      chunks.push({
        content: stmtContent,
        filePath,
        language: "sql",
        layer: "database",
        startLine: start,
        endLine: end,
        symbolName: null,
        parentSymbol: null,
        chunkType: "statement",
        annotations: [],
        chunkIndex: i,
        totalChunks: statementStarts.length,
        headerChunkId: null,
      });
    }
  }

  return chunks;
}

// --- Main Chunker ---

export function chunkFile(content: string, filePath: string): ASTChunk[] {
  const language = detectLanguage(filePath);
  if (!language) return [];

  const layer = inferLayer(filePath);

  switch (language) {
    case "java":
      return chunkJavaAST(content, filePath, layer);
    case "vue":
      return chunkVueAST(content, filePath, layer);
    case "typescript":
      return chunkTypeScriptAST(content, filePath, layer);
    case "sql":
      return chunkSQL(content, filePath);
    default:
      return [];
  }
}
