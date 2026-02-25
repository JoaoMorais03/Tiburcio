// indexer/ast-chunker.ts — Tree-sitter AST-based code chunking.
// One file, one interface, language-agnostic boundary-based algorithm.
// Inspired by cAST (EMNLP 2025): language-agnostic chunking works across all languages.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const Parser = require("tree-sitter") as typeof import("tree-sitter");
const JavaGrammar = require("tree-sitter-java");
const TSGrammar = require("tree-sitter-typescript").typescript;

// --- Types ---

export interface ASTChunk {
  content: string;
  filePath: string;
  language: "java" | "typescript" | "vue" | "sql";
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

// --- Language Configuration ---

interface LanguageConfig {
  headerNodeTypes: string[];
  boundaryNodeTypes: string[];
  annotationNodeType: string | null;
  extractSymbolName: (node: TSNode) => string | null;
  extractParentSymbol: (node: TSNode) => string | null;
  chunkTypeFor: (node: TSNode) => string;
}

interface TSNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  namedChildren: TSNode[];
  parent: TSNode | null;
  childForFieldName(name: string): TSNode | null;
  previousNamedSibling: TSNode | null;
}

// --- Parser Singletons ---

const javaParser = new Parser();
javaParser.setLanguage(JavaGrammar);

const tsParser = new Parser();
tsParser.setLanguage(TSGrammar);

// --- Shared Helpers ---

function findName(node: TSNode, field: string): string | null {
  return node.childForFieldName(field)?.text ?? null;
}

function findParentClass(node: TSNode): string | null {
  let p = node.parent;
  while (p) {
    if (CLASS_LIKE_TYPES.has(p.type)) return findName(p, "name");
    p = p.parent;
  }
  return null;
}

/**
 * Extract annotations from a node.
 * Strategy 1: preceding sibling nodes (TS decorators).
 * Strategy 2: inside "modifiers" child (Java annotations).
 */
function extractAnnotations(node: TSNode, annotationType: string | null): string[] {
  if (!annotationType) return [];
  const result: string[] = [];

  // Sibling decorators (TypeScript)
  let sib = node.previousNamedSibling;
  while (sib && sib.type === annotationType) {
    result.unshift(sib.text.split("\n")[0].trim());
    sib = sib.previousNamedSibling;
  }

  // Modifiers child (Java)
  if (result.length === 0) {
    const mods =
      node.childForFieldName("modifiers") ?? node.namedChildren.find((c) => c.type === "modifiers");
    if (mods) {
      for (const ch of mods.namedChildren) {
        if (ch.type === "marker_annotation" || ch.type === "annotation") {
          result.push(ch.text.split("\n")[0].trim());
        }
      }
    }
  }

  return result;
}

/** Find the start line of any annotations/decorators preceding a node. */
function annotationStartRow(node: TSNode, config: LanguageConfig): number {
  let sib = node.previousNamedSibling;
  let row = node.startPosition.row;
  while (sib && isAnnotation(sib, config)) {
    row = sib.startPosition.row;
    sib = sib.previousNamedSibling;
  }
  return row;
}

function isAnnotation(node: TSNode, config: LanguageConfig): boolean {
  return (
    node.type === "annotation" ||
    node.type === "marker_annotation" ||
    node.type === config.annotationNodeType
  );
}

// --- Shared Constants ---

const CLASS_LIKE_TYPES = new Set([
  "class_declaration",
  "enum_declaration",
  "interface_declaration",
  "record_declaration",
]);
const BODY_NODE_TYPES = new Set([
  "class_body",
  "interface_body",
  "enum_body",
  "record_declaration_body",
]);
const METHOD_TYPES = new Set([
  "method_declaration",
  "constructor_declaration",
  "compact_constructor_declaration",
]);
const MAX_CHUNK_CHARS = 3000;

// --- Java Config ---

const JAVA_CHUNK_TYPE_MAP: Record<string, string> = {
  method_declaration: "method",
  constructor_declaration: "constructor",
  class_declaration: "class",
  interface_declaration: "interface",
  enum_declaration: "enum",
  record_declaration: "record",
};

const javaConfig: LanguageConfig = {
  headerNodeTypes: [
    "package_declaration",
    "import_declaration",
    "field_declaration",
    "static_initializer",
  ],
  boundaryNodeTypes: [
    "method_declaration",
    "constructor_declaration",
    "class_declaration",
    "interface_declaration",
    "enum_declaration",
    "record_declaration",
  ],
  annotationNodeType: "marker_annotation",
  extractSymbolName: (node) => findName(node, "name"),
  extractParentSymbol: findParentClass,
  chunkTypeFor: (node) => JAVA_CHUNK_TYPE_MAP[node.type] ?? "other",
};

// --- TypeScript Helpers ---

function nameFromLexical(node: TSNode): string | null {
  const decl = node.namedChildren.find((c) => c.type === "variable_declarator");
  return decl ? findName(decl, "name") : null;
}

function nameFromExport(node: TSNode): string | null {
  for (const ch of node.namedChildren) {
    if (ch.type === "lexical_declaration") return nameFromLexical(ch);
    const n = findName(ch, "name");
    if (n) return n;
  }
  return null;
}

const TS_TYPE_MAP: Record<string, string> = {
  function_declaration: "function",
  class_declaration: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
  lexical_declaration: "const",
};

function exportChunkType(node: TSNode): string {
  for (const ch of node.namedChildren) {
    if (TS_TYPE_MAP[ch.type]) return TS_TYPE_MAP[ch.type];
  }
  return "export";
}

// --- TypeScript Config ---

const tsConfig: LanguageConfig = {
  headerNodeTypes: ["import_statement"],
  boundaryNodeTypes: [
    "export_statement",
    "function_declaration",
    "class_declaration",
    "interface_declaration",
    "type_alias_declaration",
    "enum_declaration",
    "lexical_declaration",
  ],
  annotationNodeType: "decorator",
  extractSymbolName: (node) => {
    if (node.type === "export_statement") return nameFromExport(node);
    if (node.type === "lexical_declaration") return nameFromLexical(node);
    return findName(node, "name");
  },
  extractParentSymbol: findParentClass,
  chunkTypeFor: (node) => {
    if (node.type === "export_statement") return exportChunkType(node);
    return TS_TYPE_MAP[node.type] ?? "other";
  },
};

// --- Core Chunking: Classify → Build Header → Build Boundaries ---

interface RawChunk {
  content: string;
  startLine: number;
  endLine: number;
  symbolName: string | null;
  parentSymbol: string | null;
  chunkType: string;
  annotations: string[];
}

/** Check if an annotation at index belongs to the next boundary node. */
function annotBelongsToBoundary(idx: number, children: TSNode[], config: LanguageConfig): boolean {
  let next = idx + 1;
  while (next < children.length && isAnnotation(children[next], config)) next++;
  return next < children.length && config.boundaryNodeTypes.includes(children[next].type);
}

/** Classify top-level AST children into header and boundary entries. */
function classifyChildren(children: TSNode[], config: LanguageConfig) {
  const headers: TSNode[] = [];
  const boundaries: Array<{ node: TSNode; annotations: string[] }> = [];

  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (config.headerNodeTypes.includes(node.type)) {
      headers.push(node);
    } else if (config.annotationNodeType && isAnnotation(node, config)) {
      if (!annotBelongsToBoundary(i, children, config)) headers.push(node);
    } else if (config.boundaryNodeTypes.includes(node.type)) {
      boundaries.push({
        node,
        annotations: extractAnnotations(node, config.annotationNodeType),
      });
    } else if (boundaries.length === 0) {
      headers.push(node);
    }
  }

  return { headers, boundaries };
}

function makeHeaderChunk(headers: TSNode[], lines: string[]): RawChunk | null {
  if (headers.length === 0) return null;
  const endRow = headers[headers.length - 1].endPosition.row;
  const content = lines.slice(0, endRow + 1).join("\n");
  if (!content.trim()) return null;
  return {
    content,
    startLine: 1,
    endLine: endRow + 1,
    symbolName: null,
    parentSymbol: null,
    chunkType: "header",
    annotations: [],
  };
}

function makeBoundaryChunk(
  node: TSNode,
  annotations: string[],
  lines: string[],
  config: LanguageConfig,
): RawChunk | null {
  const startRow =
    annotations.length > 0 ? annotationStartRow(node, config) : node.startPosition.row;
  const endRow = node.endPosition.row;
  const content = lines.slice(startRow, endRow + 1).join("\n");
  if (!content.trim()) return null;
  return {
    content,
    startLine: startRow + 1,
    endLine: endRow + 1,
    symbolName: config.extractSymbolName(node),
    parentSymbol: config.extractParentSymbol(node),
    chunkType: config.chunkTypeFor(node),
    annotations,
  };
}

/** Split a class body into header (fields, declaration) + individual method chunks. */
function splitClassBody(
  classNode: TSNode,
  lines: string[],
  config: LanguageConfig,
  className: string | null,
): RawChunk[] {
  const bodyNode = classNode.namedChildren.find((c) => BODY_NODE_TYPES.has(c.type));
  if (!bodyNode) return [];

  const bodyChildren = bodyNode.namedChildren;
  const firstMethodIdx = bodyChildren.findIndex((c) => METHOD_TYPES.has(c.type));
  if (firstMethodIdx < 0) return [];

  const chunks: RawChunk[] = [];
  const classStart = classNode.startPosition.row;
  const headerEnd = annotationStartRow(bodyChildren[firstMethodIdx], config) - 1;

  if (headerEnd >= classStart) {
    const hdr = lines.slice(classStart, headerEnd + 1).join("\n");
    if (hdr.trim()) {
      chunks.push({
        content: hdr,
        startLine: classStart + 1,
        endLine: headerEnd + 1,
        symbolName: className,
        parentSymbol: null,
        chunkType: "header",
        annotations: [],
      });
    }
  }

  for (const child of bodyChildren) {
    if (!METHOD_TYPES.has(child.type)) continue;
    const startRow = annotationStartRow(child, config);
    const endRow = child.endPosition.row;
    const content = lines.slice(startRow, endRow + 1).join("\n");
    if (!content.trim()) continue;
    chunks.push({
      content,
      startLine: startRow + 1,
      endLine: endRow + 1,
      symbolName: findName(child, "name"),
      parentSymbol: className,
      chunkType: child.type === "constructor_declaration" ? "constructor" : "method",
      annotations: extractAnnotations(child, config.annotationNodeType),
    });
  }

  // Extend last chunk to include class closing brace
  const classEnd = classNode.endPosition.row;
  if (chunks.length > 0 && chunks[chunks.length - 1].endLine - 1 < classEnd) {
    const last = chunks[chunks.length - 1];
    last.content = lines.slice(last.startLine - 1, classEnd + 1).join("\n");
    last.endLine = classEnd + 1;
  }

  return chunks;
}

/** Safe parse — returns null if tree-sitter fails (caller falls back to single chunk). */
function safeParse(
  source: string,
  parser: InstanceType<typeof Parser>,
): ReturnType<InstanceType<typeof Parser>["parse"]> | null {
  try {
    return parser.parse(source);
  } catch {
    return null;
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: AST walking is inherently complex
function chunkWithAST(
  source: string,
  parser: InstanceType<typeof Parser>,
  config: LanguageConfig,
): RawChunk[] {
  const tree = safeParse(source, parser);
  if (!tree) return [];

  const root = tree.rootNode as unknown as TSNode;
  const lines = source.split("\n");
  const children = root.namedChildren;
  if (children.length === 0) return [];

  const { headers, boundaries } = classifyChildren(children, config);
  const chunks: RawChunk[] = [];

  const hdr = makeHeaderChunk(headers, lines);
  if (hdr) chunks.push(hdr);

  for (const { node, annotations } of boundaries) {
    if (CLASS_LIKE_TYPES.has(node.type)) {
      const name = config.extractSymbolName(node);
      const classChunks = splitClassBody(node, lines, config, name);
      if (classChunks.length > 0) {
        if (annotations.length > 0 && classChunks[0]) classChunks[0].annotations = annotations;
        chunks.push(...classChunks);
        continue;
      }
    }
    const chunk = makeBoundaryChunk(node, annotations, lines, config);
    if (chunk) chunks.push(chunk);
  }

  return chunks;
}

// --- Vue SFC Handling ---

const VUE_SECTION_RE = /<(template|script|style)(\s[^>]*)?>[\s\S]*?<\/\1>/g;
const SCRIPT_CONTENT_RE = /<script[^>]*>([\s\S]*?)<\/script>/;

function nonWSLen(text: string): number {
  return text.replace(/\s/g, "").length;
}

interface SFCSection {
  tag: string;
  content: string;
  startLine: number;
  endLine: number;
}

function parseSFCSections(source: string): SFCSection[] {
  const sections: SFCSection[] = [];
  VUE_SECTION_RE.lastIndex = 0;
  for (let m = VUE_SECTION_RE.exec(source); m !== null; m = VUE_SECTION_RE.exec(source)) {
    const startLine = source.substring(0, m.index).split("\n").length;
    const endLine = startLine + m[0].split("\n").length - 1;
    sections.push({ tag: m[1], content: m[0], startLine, endLine });
  }
  return sections;
}

function tryChunkLargeScript(sec: SFCSection, filePath: string, layer: string): ASTChunk[] | null {
  if (sec.tag !== "script" || nonWSLen(sec.content) <= MAX_CHUNK_CHARS) return null;
  const inner = SCRIPT_CONTENT_RE.exec(sec.content)?.[1];
  if (!inner?.trim()) return null;
  const rawChunks = chunkWithAST(inner, tsParser, tsConfig);
  if (rawChunks.length <= 1) return null;
  return rawChunks.map((raw) => ({
    ...raw,
    filePath,
    language: "vue" as const,
    layer,
    startLine: sec.startLine + raw.startLine - 1,
    endLine: sec.startLine + raw.endLine - 1,
    chunkIndex: 0,
    totalChunks: 0,
    headerChunkId: null,
  }));
}

function sectionToChunk(sec: SFCSection, filePath: string, layer: string): ASTChunk {
  return {
    content: sec.content,
    filePath,
    language: "vue",
    layer,
    startLine: sec.startLine,
    endLine: sec.endLine,
    symbolName: null,
    parentSymbol: null,
    chunkType: sec.tag === "template" ? "template" : "script",
    annotations: [],
    chunkIndex: 0,
    totalChunks: 0,
    headerChunkId: null,
  };
}

export function chunkVueAST(source: string, filePath: string, layer: string): ASTChunk[] {
  const sections = parseSFCSections(source);
  if (sections.length === 0) return [singleChunk(source, filePath, "vue", layer, "component")];

  const chunks: ASTChunk[] = [];
  for (const sec of sections) {
    if (sec.tag === "style") continue;
    const scriptChunks = tryChunkLargeScript(sec, filePath, layer);
    if (scriptChunks) {
      chunks.push(...scriptChunks);
    } else {
      chunks.push(sectionToChunk(sec, filePath, layer));
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    chunks[i].chunkIndex = i;
    chunks[i].totalChunks = chunks.length;
  }
  return chunks;
}

// --- Single Chunk Helper ---

function singleChunk(
  source: string,
  filePath: string,
  language: ASTChunk["language"],
  layer: string,
  chunkType: string,
): ASTChunk {
  return {
    content: source,
    filePath,
    language,
    layer,
    startLine: 1,
    endLine: source.split("\n").length,
    symbolName: null,
    parentSymbol: null,
    chunkType,
    annotations: [],
    chunkIndex: 0,
    totalChunks: 1,
    headerChunkId: null,
  };
}

function rawToAST(
  rawChunks: RawChunk[],
  filePath: string,
  language: ASTChunk["language"],
  layer: string,
): ASTChunk[] {
  return rawChunks.map((raw, i) => ({
    ...raw,
    filePath,
    language,
    layer,
    chunkIndex: i,
    totalChunks: rawChunks.length,
    headerChunkId: null,
  }));
}

// --- Public API ---

export function chunkJavaAST(source: string, filePath: string, layer: string): ASTChunk[] {
  if (source.length <= MAX_CHUNK_CHARS)
    return [singleChunk(source, filePath, "java", layer, "file")];
  const raw = chunkWithAST(source, javaParser, javaConfig);
  if (raw.length === 0) return [singleChunk(source, filePath, "java", layer, "file")];
  return rawToAST(raw, filePath, "java", layer);
}

export function chunkTypeScriptAST(source: string, filePath: string, layer: string): ASTChunk[] {
  if (source.length <= MAX_CHUNK_CHARS)
    return [singleChunk(source, filePath, "typescript", layer, "file")];
  const raw = chunkWithAST(source, tsParser, tsConfig);
  if (raw.length === 0) return [singleChunk(source, filePath, "typescript", layer, "file")];
  return rawToAST(raw, filePath, "typescript", layer);
}
