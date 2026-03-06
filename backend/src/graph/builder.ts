// graph/builder.ts — Full graph rebuild from source files.
// Drops all nodes for each repo and rebuilds using batch UNWIND inserts.
// Called nightly after Qdrant indexing. Target: <5s for a single monolith.

import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import type { RepoConfig } from "../config/env.js";
import { logger } from "../config/logger.js";
import { ensureGraphSchema, isGraphAvailable, runCypher } from "./client.js";
import { extractGraph, type GraphData } from "./extractor.js";

const BATCH_SIZE = 500;
const SOURCE_EXTENSIONS = new Set([".java", ".ts", ".tsx", ".vue"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "target",
  "build",
  "dist",
  ".idea",
  "test",
  "__tests__",
  "cypress",
]);

async function findSourceFiles(dir: string, baseDir: string): Promise<string[]> {
  const files: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await findSourceFiles(full, baseDir)));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(relative(baseDir, full));
    }
  }
  return files;
}

async function batchUpsertNodes(nodes: GraphData["nodes"]): Promise<void> {
  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE);
    await runCypher(
      `UNWIND $batch AS n
       FOREACH (_ IN CASE n.type WHEN 'File' THEN [1] ELSE [] END |
         MERGE (x:File {id: n.id}) SET x.name = n.name, x.filePath = n.filePath, x.repo = n.repo)
       FOREACH (_ IN CASE n.type WHEN 'Function' THEN [1] ELSE [] END |
         MERGE (x:Function {id: n.id}) SET x.name = n.name, x.filePath = n.filePath, x.repo = n.repo)
       FOREACH (_ IN CASE n.type WHEN 'Class' THEN [1] ELSE [] END |
         MERGE (x:Class {id: n.id}) SET x.name = n.name, x.filePath = n.filePath, x.repo = n.repo)
       FOREACH (_ IN CASE n.type WHEN 'Table' THEN [1] ELSE [] END |
         MERGE (x:Table {id: n.id}) SET x.name = n.name, x.repo = n.repo)`,
      { batch },
    ).catch((err) => logger.warn({ err }, "Node upsert batch failed"));
  }
}

async function batchUpsertEdges(edges: GraphData["edges"]): Promise<void> {
  // IMPORTS: only resolved edges (target file exists in repo)
  const resolvedImports = edges.filter((e) => e.type === "IMPORTS" && e.resolved);
  for (let i = 0; i < resolvedImports.length; i += BATCH_SIZE) {
    const batch = resolvedImports.slice(i, i + BATCH_SIZE);
    await runCypher(
      `UNWIND $batch AS e
       MATCH (a:File {id: e.from}), (b:File {id: e.to})
       MERGE (a)-[:IMPORTS]->(b)`,
      { batch },
    ).catch(() => {});
  }

  // EXTENDS: by class name (best-effort)
  const extendsEdges = edges.filter((e) => e.type === "EXTENDS");
  for (let i = 0; i < extendsEdges.length; i += BATCH_SIZE) {
    const batch = extendsEdges.slice(i, i + BATCH_SIZE);
    await runCypher(
      `UNWIND $batch AS e
       MATCH (a {id: e.from})
       MATCH (b:Class {name: e.to})
       MERGE (a)-[:EXTENDS]->(b)`,
      { batch },
    ).catch(() => {});
  }

  // QUERIES: Table references (resolved)
  const queryEdges = edges.filter((e) => e.type === "QUERIES");
  for (let i = 0; i < queryEdges.length; i += BATCH_SIZE) {
    const batch = queryEdges.slice(i, i + BATCH_SIZE);
    await runCypher(
      `UNWIND $batch AS e
       MATCH (a {id: e.from})
       MATCH (b:Table {id: e.to})
       MERGE (a)-[:QUERIES]->(b)`,
      { batch },
    ).catch(() => {});
  }
}

/**
 * Full graph rebuild for all configured repos.
 * No-op if NEO4J_URI is not set.
 */
export async function buildGraph(repos: RepoConfig[]): Promise<{ nodes: number; edges: number }> {
  if (!isGraphAvailable()) return { nodes: 0, edges: 0 };

  await ensureGraphSchema();

  let totalNodes = 0;
  let totalEdges = 0;

  for (const repo of repos) {
    logger.info({ repo: repo.name }, "Rebuilding graph for repo");

    // Drop all existing nodes for this repo (idempotent rebuild)
    await runCypher("MATCH (n) WHERE n.repo = $repo DETACH DELETE n", {
      repo: repo.name,
    }).catch(() => {});

    const filePaths = await findSourceFiles(repo.path, repo.path);
    const allFilePathsSet = new Set(filePaths);

    const allNodes: GraphData["nodes"] = [];
    const allEdges: GraphData["edges"] = [];

    for (const relPath of filePaths) {
      const fullPath = join(repo.path, relPath);
      try {
        const content = await readFile(fullPath, "utf-8");
        const { nodes, edges } = extractGraph(content, relPath, repo.name, allFilePathsSet);
        allNodes.push(...nodes);
        allEdges.push(...edges);
      } catch {
        // Skip unreadable files
      }
    }

    await batchUpsertNodes(allNodes);
    await batchUpsertEdges(allEdges);

    totalNodes += allNodes.length;
    totalEdges += allEdges.length;
    logger.info(
      { repo: repo.name, nodes: allNodes.length, edges: allEdges.length },
      "Graph built for repo",
    );
  }

  logger.info({ totalNodes, totalEdges }, "Graph rebuild complete");
  return { nodes: totalNodes, edges: totalEdges };
}
