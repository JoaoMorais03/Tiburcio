// tools/get-impact-analysis.ts — Graph traversal for dependency impact analysis.
// Returns which files/functions/classes depend on a given target (direct + transitive).
// Returns { available: false } gracefully when NEO4J_URI is not configured.

import { tool } from "ai";
import neo4j from "neo4j-driver";
import { z } from "zod";

import { logger } from "../../config/logger.js";
import { isGraphAvailable, runCypher } from "../../graph/client.js";

interface ImpactRow {
  dependentFile: string;
  dependentSymbol: string | null;
  depth: number;
}

const CYPHER_BY_TYPE: Record<"file" | "function" | "class" | "table", string> = {
  file: `
    MATCH path = (dep)-[:IMPORTS*1..$depth]->(target:File {filePath: $target})
    WHERE dep.repo = $repo OR $repo = ''
    RETURN dep.filePath AS dependentFile, null AS dependentSymbol, length(path) AS depth
    ORDER BY depth, dep.filePath LIMIT 50
  `,
  function: `
    MATCH path = (caller)-[:CALLS*1..$depth]->(target:Function {name: $target})
    WHERE target.repo = $repo OR $repo = ''
    RETURN caller.filePath AS dependentFile, caller.name AS dependentSymbol, length(path) AS depth
    ORDER BY depth LIMIT 50
  `,
  class: `
    MATCH path = (dep)-[:EXTENDS|CALLS*1..$depth]->(target:Class {name: $target})
    WHERE target.repo = $repo OR $repo = ''
    RETURN dep.filePath AS dependentFile, dep.name AS dependentSymbol, length(path) AS depth
    ORDER BY depth LIMIT 50
  `,
  table: `
    MATCH path = (caller)-[:QUERIES*1..$depth]->(target:Table {name: $target})
    WHERE target.repo = $repo OR $repo = ''
    RETURN caller.filePath AS dependentFile, caller.name AS dependentSymbol, length(path) AS depth
    ORDER BY depth LIMIT 50
  `,
};

export async function executeGetImpactAnalysis(
  target: string,
  targetType: "file" | "function" | "class" | "table",
  depth = 2,
  repo?: string,
) {
  if (!isGraphAvailable()) {
    return {
      available: false,
      message:
        "Graph features require NEO4J_URI to be configured. " +
        "Start Neo4j with: docker compose --profile graph up -d",
    };
  }

  if (targetType === "function") {
    return {
      available: false,
      message:
        "Function-level impact analysis is not yet supported. The graph layer tracks file imports, class inheritance, and table queries. Use targetType: 'file' or 'class' instead.",
    };
  }

  const cypher = CYPHER_BY_TYPE[targetType];
  if (!cypher) {
    return { available: false, message: `Unknown target type: ${targetType}` };
  }

  try {
    const rows = await runCypher<ImpactRow>(cypher, {
      target,
      depth: neo4j.int(depth),
      repo: repo ?? "",
    });

    if (rows.length === 0) {
      return {
        available: true,
        target,
        targetType,
        depth,
        dependents: [],
        summary: `No dependents found for ${targetType} "${target}" within depth ${depth}. Either nothing depends on it, or the graph has not been built yet (run the nightly pipeline).`,
      };
    }

    const direct = rows.filter((r) => r.depth === 1).length;
    const topFiles = rows
      .slice(0, 3)
      .map((r) => r.dependentFile)
      .join(", ");
    const summary =
      `${rows.length} dependent(s) found (${direct} direct, ${rows.length - direct} transitive). ` +
      `Changing ${targetType} "${target}" affects: ${topFiles}` +
      (rows.length > 3 ? ` and ${rows.length - 3} more.` : ".");

    return {
      available: true,
      target,
      targetType,
      depth,
      dependents: rows.map((r) => ({
        file: r.dependentFile,
        symbol: r.dependentSymbol ?? null,
        depth: r.depth,
      })),
      summary,
    };
  } catch (err) {
    logger.error({ err, target, targetType }, "getImpactAnalysis query failed");
    return {
      available: false,
      message: "Graph query failed. Neo4j may not be running or the graph has not been built yet.",
    };
  }
}

export const getImpactAnalysisTool = tool({
  description:
    "Trace dependency impact for a file, function, class, or table using the graph layer. " +
    "Returns all code that directly or transitively depends on the target. " +
    "Use before refactoring to understand blast radius.",
  inputSchema: z.object({
    target: z.string().describe("File path, function name, class name, or table name"),
    targetType: z.enum(["file", "function", "class", "table"]),
    depth: z.number().min(1).max(3).default(2).describe("Traversal depth (1-3)"),
    repo: z.string().optional().describe("Filter by repo name"),
  }),
  execute: ({ target, targetType, depth, repo }) =>
    executeGetImpactAnalysis(target, targetType, depth, repo),
});
