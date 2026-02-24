// indexer/chunker.ts — Smart code chunker that splits by language-aware boundaries.
// Java: method/class boundaries. Vue: SFC sections. TypeScript: exports. SQL: statements.
// Each chunk gets a layer tag inferred from the file path (service, controller, etc.).

// --- Types ---

interface CodeChunk {
  /** The actual source code text */
  content: string;
  /** Relative path from the codebase root */
  filePath: string;
  /** Programming language: java, typescript, vue, sql */
  language: "java" | "typescript" | "vue" | "sql";
  /** Architectural layer inferred from the file path */
  layer: string;
  /** Line number where this chunk starts (1-based) */
  startLine: number;
  /** Line number where this chunk ends (1-based) */
  endLine: number;
}

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

function inferLayer(filePath: string): string {
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

// --- Java Chunking ---

const JAVA_METHOD_REGEX =
  /^[ \t]*(?:@\w+(?:\(.*?\))?\s*\n)*[ \t]*(?:public|private|protected|static|final|abstract|synchronized|default|native|\s)*\s+[\w<>[\],\s]+\s+\w+\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/gm;

const MAX_CHUNK_SIZE = 3000; // chars — roughly fits in ~750 tokens

function chunkJava(content: string, filePath: string, layer: string): CodeChunk[] {
  // Small files → single chunk
  if (content.length <= MAX_CHUNK_SIZE) {
    return [
      {
        content,
        filePath,
        language: "java",
        layer,
        startLine: 1,
        endLine: content.split("\n").length,
      },
    ];
  }

  const lines = content.split("\n");
  const chunks: CodeChunk[] = [];

  // Find method start line numbers using regex
  const methodStarts: number[] = [];
  JAVA_METHOD_REGEX.lastIndex = 0;

  for (
    let match = JAVA_METHOD_REGEX.exec(content);
    match !== null;
    match = JAVA_METHOD_REGEX.exec(content)
  ) {
    // Count lines before this match to get line number
    const lineNum = content.substring(0, match.index).split("\n").length;
    methodStarts.push(lineNum);
  }

  if (methodStarts.length === 0) {
    // No methods found — keep as single chunk
    return [
      {
        content,
        filePath,
        language: "java",
        layer,
        startLine: 1,
        endLine: lines.length,
      },
    ];
  }

  // Check for annotations above each method (walk backwards from method line)
  const adjustedStarts = methodStarts.map((lineNum) => {
    let start = lineNum;
    while (start > 1 && lines[start - 2]?.trim().startsWith("@")) {
      start--;
    }
    return start;
  });

  // Header chunk: everything before the first method (package, imports, class declaration, fields)
  if (adjustedStarts[0] > 1) {
    const headerEnd = adjustedStarts[0] - 1;
    const headerContent = lines.slice(0, headerEnd).join("\n");
    if (headerContent.trim().length > 0) {
      chunks.push({
        content: headerContent,
        filePath,
        language: "java",
        layer,
        startLine: 1,
        endLine: headerEnd,
      });
    }
  }

  // Method chunks: from each method start to the next method start (or EOF)
  for (let i = 0; i < adjustedStarts.length; i++) {
    const start = adjustedStarts[i];
    const end = i < adjustedStarts.length - 1 ? adjustedStarts[i + 1] - 1 : lines.length;
    const methodContent = lines.slice(start - 1, end).join("\n");

    if (methodContent.trim().length > 0) {
      chunks.push({
        content: methodContent,
        filePath,
        language: "java",
        layer,
        startLine: start,
        endLine: end,
      });
    }
  }

  return chunks;
}

// --- Vue SFC Chunking ---

const VUE_SECTION_REGEX = /<(template|script|style)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g;

function chunkVue(content: string, filePath: string, layer: string): CodeChunk[] {
  // Small components → single chunk
  if (content.length <= MAX_CHUNK_SIZE) {
    return [
      {
        content,
        filePath,
        language: "vue",
        layer,
        startLine: 1,
        endLine: content.split("\n").length,
      },
    ];
  }

  const chunks: CodeChunk[] = [];
  VUE_SECTION_REGEX.lastIndex = 0;

  for (
    let sectionMatch = VUE_SECTION_REGEX.exec(content);
    sectionMatch !== null;
    sectionMatch = VUE_SECTION_REGEX.exec(content)
  ) {
    const sectionContent = sectionMatch[0];
    const startLine = content.substring(0, sectionMatch.index).split("\n").length;
    const endLine = startLine + sectionContent.split("\n").length - 1;

    chunks.push({
      content: sectionContent,
      filePath,
      language: "vue",
      layer,
      startLine,
      endLine,
    });
  }

  // If regex found nothing (malformed SFC), fall back to whole file
  if (chunks.length === 0) {
    return [
      {
        content,
        filePath,
        language: "vue",
        layer,
        startLine: 1,
        endLine: content.split("\n").length,
      },
    ];
  }

  return chunks;
}

// --- TypeScript Chunking ---

const TS_EXPORT_REGEX =
  /^(?:export\s+(?:default\s+)?(?:function|const|let|class|interface|type|enum|async\s+function))/gm;

function chunkTypeScript(content: string, filePath: string, layer: string): CodeChunk[] {
  if (content.length <= MAX_CHUNK_SIZE) {
    return [
      {
        content,
        filePath,
        language: "typescript",
        layer,
        startLine: 1,
        endLine: content.split("\n").length,
      },
    ];
  }

  const lines = content.split("\n");
  const exportStarts: number[] = [];
  TS_EXPORT_REGEX.lastIndex = 0;

  for (
    let tsMatch = TS_EXPORT_REGEX.exec(content);
    tsMatch !== null;
    tsMatch = TS_EXPORT_REGEX.exec(content)
  ) {
    const lineNum = content.substring(0, tsMatch.index).split("\n").length;
    exportStarts.push(lineNum);
  }

  if (exportStarts.length <= 1) {
    // 0 or 1 exports — keep as single chunk
    return [
      {
        content,
        filePath,
        language: "typescript",
        layer,
        startLine: 1,
        endLine: lines.length,
      },
    ];
  }

  const chunks: CodeChunk[] = [];

  // Header: imports and setup before first export
  if (exportStarts[0] > 1) {
    const headerContent = lines.slice(0, exportStarts[0] - 1).join("\n");
    if (headerContent.trim().length > 0) {
      chunks.push({
        content: headerContent,
        filePath,
        language: "typescript",
        layer,
        startLine: 1,
        endLine: exportStarts[0] - 1,
      });
    }
  }

  // Export chunks
  for (let i = 0; i < exportStarts.length; i++) {
    const start = exportStarts[i];
    const end = i < exportStarts.length - 1 ? exportStarts[i + 1] - 1 : lines.length;
    const chunkContent = lines.slice(start - 1, end).join("\n");

    if (chunkContent.trim().length > 0) {
      chunks.push({
        content: chunkContent,
        filePath,
        language: "typescript",
        layer,
        startLine: start,
        endLine: end,
      });
    }
  }

  return chunks;
}

// --- SQL Chunking ---

const SQL_STATEMENT_REGEX =
  /^(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|BEGIN|COMMIT)\b/gim;

function chunkSQL(content: string, filePath: string): CodeChunk[] {
  if (content.length <= MAX_CHUNK_SIZE) {
    return [
      {
        content,
        filePath,
        language: "sql",
        layer: "database",
        startLine: 1,
        endLine: content.split("\n").length,
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
      },
    ];
  }

  const chunks: CodeChunk[] = [];
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
      });
    }
  }

  return chunks;
}

// --- Main Chunker ---

export function chunkFile(content: string, filePath: string): CodeChunk[] {
  const language = detectLanguage(filePath);
  if (!language) return [];

  const layer = inferLayer(filePath);

  switch (language) {
    case "java":
      return chunkJava(content, filePath, layer);
    case "vue":
      return chunkVue(content, filePath, layer);
    case "typescript":
      return chunkTypeScript(content, filePath, layer);
    case "sql":
      return chunkSQL(content, filePath);
    default:
      return [];
  }
}
