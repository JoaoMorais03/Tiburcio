// graph/extractor.ts — Extract graph relationships from source files using regex.
// Conservative approach: when ambiguous, skip. Wrong edges are worse than missing edges.
// Supports TypeScript (.ts, .tsx, .vue) and Java (.java) files.

export interface GraphNode {
  type: "File" | "Function" | "Class" | "Table";
  id: string; // filePath for File nodes; "filePath::name" for Function/Class
  name: string;
  filePath: string;
  repo: string;
}

export interface GraphEdge {
  from: string; // node id
  to: string; // node id or raw import path/name
  type: "IMPORTS" | "CALLS" | "EXTENDS" | "QUERIES";
  resolved: boolean; // true = target ID exists in the repo
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Resolve a relative import path to a known file path in the repo. */
function resolveImport(
  importPath: string,
  fromFile: string,
  allFilePaths: Set<string>,
): { path: string; resolved: boolean } {
  if (!importPath.startsWith(".")) {
    return { path: importPath, resolved: false }; // external package
  }

  const dir = fromFile.split("/").slice(0, -1).join("/");
  const base = dir ? `${dir}/${importPath}` : importPath;
  const normalize = (p: string) => p.replace(/\/\.\//g, "/").replace(/\/\//g, "/");

  const candidates = [
    normalize(base),
    normalize(`${base}.ts`),
    normalize(`${base}.tsx`),
    normalize(`${base}.vue`),
    normalize(`${base}/index.ts`),
  ];

  for (const c of candidates) {
    if (allFilePaths.has(c)) return { path: c, resolved: true };
  }
  return { path: importPath, resolved: false };
}

/** Dedup-insert a Table node and add a QUERIES edge. */
function upsertTableRef(
  tableName: string,
  fromId: string,
  repo: string,
  nodes: GraphNode[],
  seenIds: Set<string>,
  edges: GraphEdge[],
): void {
  const tableId = `table::${tableName}`;
  if (!seenIds.has(tableId)) {
    seenIds.add(tableId);
    nodes.push({ type: "Table", id: tableId, name: tableName, filePath: "", repo });
  }
  edges.push({ from: fromId, to: tableId, type: "QUERIES", resolved: true });
}

const SQL_SKIP_WORDS = new Set([
  "select",
  "where",
  "and",
  "or",
  "not",
  "null",
  "true",
  "false",
  "the",
  "that",
]);

/** Scan a SQL string for table references and add them to nodes/edges. */
function extractSqlTableRefs(
  sql: string,
  fromId: string,
  repo: string,
  nodes: GraphNode[],
  seenIds: Set<string>,
  edges: GraphEdge[],
): void {
  const sqlRe = /(?:FROM|INTO|UPDATE|JOIN)\s+["'`]?([a-z_][a-z0-9_]{2,})["'`]?/gi;
  for (const m of sql.matchAll(sqlRe)) {
    const tableName = m[1].toLowerCase();
    if (!SQL_SKIP_WORDS.has(tableName)) {
      upsertTableRef(tableName, fromId, repo, nodes, seenIds, edges);
    }
  }
}

function extractTypeScript(
  content: string,
  filePath: string,
  fileId: string,
  repo: string,
  nodes: GraphNode[],
  seenIds: Set<string>,
  edges: GraphEdge[],
  allFilePaths: Set<string>,
): void {
  // IMPORTS: static import ... from "..." and dynamic import("...")
  const importRe =
    /(?:import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?|require\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(importRe)) {
    const raw = m[1];
    if (!raw) continue;
    const { path: resolved, resolved: isResolved } = resolveImport(raw, filePath, allFilePaths);
    edges.push({ from: fileId, to: resolved, type: "IMPORTS", resolved: isResolved });
  }

  // CLASSES: class Foo [extends Bar]
  const classRe = /\bclass\s+(\w+)(?:\s+extends\s+(\w+))?/g;
  for (const m of content.matchAll(classRe)) {
    const className = m[1];
    const nodeId = `${fileId}::${className}`;
    if (!seenIds.has(nodeId)) {
      seenIds.add(nodeId);
      nodes.push({ type: "Class", id: nodeId, name: className, filePath, repo });
    }
    if (m[2]) {
      edges.push({ from: nodeId, to: m[2], type: "EXTENDS", resolved: false });
    }
  }

  // FUNCTIONS: exported named functions (top-level only)
  const fnRe = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm;
  for (const m of content.matchAll(fnRe)) {
    const fnName = m[1];
    const nodeId = `${fileId}::${fnName}`;
    if (!seenIds.has(nodeId)) {
      seenIds.add(nodeId);
      nodes.push({ type: "Function", id: nodeId, name: fnName, filePath, repo });
    }
  }

  // TABLE REFERENCES: raw SQL patterns in strings / template literals
  extractSqlTableRefs(content, fileId, repo, nodes, seenIds, edges);
}

function extractJava(
  content: string,
  filePath: string,
  fileId: string,
  repo: string,
  nodes: GraphNode[],
  seenIds: Set<string>,
  edges: GraphEdge[],
  allFilePaths: Set<string>,
): void {
  // IMPORTS
  const importRe = /^import\s+([\w.]+);/gm;
  for (const m of content.matchAll(importRe)) {
    const pkg = m[1];
    const asPath = `${pkg.replace(/\./g, "/")}.java`;
    const resolved = allFilePaths.has(asPath);
    edges.push({ from: fileId, to: resolved ? asPath : pkg, type: "IMPORTS", resolved });
  }

  // CLASSES + EXTENDS
  const classRe = /\bclass\s+(\w+)(?:\s+extends\s+(\w+))?/g;
  for (const m of content.matchAll(classRe)) {
    const className = m[1];
    const nodeId = `${fileId}::${className}`;
    if (!seenIds.has(nodeId)) {
      seenIds.add(nodeId);
      nodes.push({ type: "Class", id: nodeId, name: className, filePath, repo });
    }
    if (m[2]) edges.push({ from: nodeId, to: m[2], type: "EXTENDS", resolved: false });
  }

  // @Table(name="...")
  const tableAnnotRe = /@Table\s*\(\s*name\s*=\s*["']([^"']+)["']/g;
  for (const m of content.matchAll(tableAnnotRe)) {
    upsertTableRef(m[1], fileId, repo, nodes, seenIds, edges);
  }

  // @Query / @NativeQuery SQL extraction
  const queryAnnotRe = /@(?:Query|NativeQuery)\s*\(\s*["']([^"']+)["']/g;
  for (const m of content.matchAll(queryAnnotRe)) {
    for (const sm of m[1].matchAll(/(?:FROM|JOIN)\s+(\w+)/gi)) {
      upsertTableRef(sm[1].toLowerCase(), fileId, repo, nodes, seenIds, edges);
    }
  }

  // Repository naming convention: OrderRepository -> table "order"
  const repoNameRe = /class\s+(\w+)Repository/g;
  for (const m of content.matchAll(repoNameRe)) {
    upsertTableRef(m[1].toLowerCase(), fileId, repo, nodes, seenIds, edges);
  }
}

/**
 * Extract graph data from a source file.
 * Returns empty arrays for unsupported file types.
 */
export function extractGraph(
  content: string,
  filePath: string,
  repo: string,
  allFilePaths: Set<string>,
): GraphData {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const isTS = ext === "ts" || ext === "tsx" || ext === "vue";
  const isJava = ext === "java";

  if (!isTS && !isJava) return { nodes: [], edges: [] };

  const fileId = filePath;
  const seenIds = new Set<string>();
  seenIds.add(fileId);
  const nodes: GraphNode[] = [
    {
      type: "File",
      id: fileId,
      name: filePath.split("/").pop() ?? filePath,
      filePath,
      repo,
    },
  ];
  const edges: GraphEdge[] = [];

  if (isTS) extractTypeScript(content, filePath, fileId, repo, nodes, seenIds, edges, allFilePaths);
  if (isJava) extractJava(content, filePath, fileId, repo, nodes, seenIds, edges, allFilePaths);

  return { nodes, edges };
}
