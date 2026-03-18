// mcp-tools.ts — Single source of truth for all MCP tool registrations.
// Both stdio (mcp.ts) and HTTP/SSE (routes/mcp.ts) call registerTools(server).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { traceToolCall } from "./lib/langfuse.js";
import { executeGetArchitecture } from "./mastra/tools/get-architecture.js";
import { executeGetChangeSummary } from "./mastra/tools/get-change-summary.js";
import { executeGetFileContext } from "./mastra/tools/get-file-context.js";
import { executeGetImpactAnalysis } from "./mastra/tools/get-impact-analysis.js";
import { executeGetNightlySummary } from "./mastra/tools/get-nightly-summary.js";
import { executeGetPattern } from "./mastra/tools/get-pattern.js";
import { executeGetTestSuggestions } from "./mastra/tools/get-test-suggestions.js";
import { executeSearchCode } from "./mastra/tools/search-code.js";
import { executeSearchReviews } from "./mastra/tools/search-reviews.js";
import { executeSearchSchemas } from "./mastra/tools/search-schemas.js";
import { executeSearchStandards } from "./mastra/tools/search-standards.js";
import { executeValidateCode } from "./mastra/tools/validate-code.js";

export const MCP_INSTRUCTIONS = `Tiburcio is a developer intelligence MCP that indexes your team's codebase, conventions, architecture, and review history into a vector database. Use it to get deep context before modifying code.

Call getFileContext when starting work on an unfamiliar file, a file with known review history, or before any refactor. Skip it for config files, generated files, or trivially small changes you just created. It returns conventions, recent review findings, and dependency information in one call.

TOOL SELECTION GUIDE:
- getFileContext — first tool when working on an unfamiliar or historically problematic file.
- searchStandards — team conventions and HOW-TO guidance (e.g. "error handling pattern"). Use instead of Grep when looking for documented rules, not exact strings.
- searchCode — semantic search across the indexed codebase. Use for "how is X implemented?" or cross-file discovery. Use Grep when you already know the exact function name.
- validateCode — check a snippet against team conventions before committing. Makes an LLM call (~3-5s). Check validated:true in the response before trusting pass:true — pass:true alone may mean the check was skipped.
- getPattern — retrieve boilerplate templates by name (e.g. "new-batch-job"). Call without a name to list all patterns.
- getArchitecture — system design docs, component flows, and data flows.
- searchSchemas — database table definitions, columns, and relationships.
- searchReviews — nightly AI review notes from recent merges. Use to find past findings on a file.
- getTestSuggestions — AI-generated test scaffolds for recently changed files.
- getNightlySummary — morning briefing of what changed overnight.
- getChangeSummary — catch up after time away ("what changed this week?").
- getImpactAnalysis — blast radius before refactoring (requires NEO4J_URI).

All search tools default to compact:true (3 results, truncated). Set compact:false for full results when initial results are insufficient.

If a response includes source:'git-log', the nightly pipeline hasn't run yet — results are raw git data, not AI-reviewed.`;

export function registerTools(server: McpServer): void {
  server.registerTool(
    "searchStandards",
    {
      description:
        "Search your team's coding standards, conventions, and best practices. " +
        "Use when you need to know HOW the team does something (transactions, " +
        "error handling, batch jobs, Vue patterns, etc.). " +
        "For actual code implementations, use searchCode instead. " +
        "For code templates, use getPattern instead.",
      inputSchema: {
        query: z.string().describe("What to search for, e.g. 'batch job error handling'"),
        category: z.enum(["backend", "frontend", "database", "integration"]).optional(),
        compact: z.boolean().default(true),
      },
      annotations: { title: "Search Standards", readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, category, compact }) => {
      const result = await traceToolCall("searchStandards", { query, category, compact }, () =>
        executeSearchStandards(query, category, compact),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "getPattern",
    {
      description:
        "Retrieve a specific code pattern or boilerplate template by name. " +
        "Use when you need ready-to-use code scaffolding for common patterns. " +
        "If you don't know the pattern name, call without a name to list available patterns.",
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe("Pattern name to retrieve. Omit to list available patterns."),
      },
      annotations: { title: "Get Pattern", readOnlyHint: true, openWorldHint: false },
    },
    async ({ name }) => {
      const result = await traceToolCall("getPattern", { name }, () => executeGetPattern(name));
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "searchCode",
    {
      description:
        "Search real production code from the indexed codebase using hybrid search (semantic + keyword matching). " +
        "Returns enriched results with symbolName, classContext, annotations, and exact line ranges. " +
        "Use this to find existing implementations, patterns, and examples. " +
        "For conventions and best practices, use searchStandards instead.",
      inputSchema: {
        query: z.string().describe("What to search for"),
        repo: z.string().optional().describe("Filter by repository name"),
        language: z.enum(["java", "typescript", "vue", "sql"]).optional(),
        layer: z
          .enum([
            "service",
            "controller",
            "repository",
            "model",
            "dto",
            "exception",
            "config",
            "constants",
            "common",
            "batch",
            "listener",
            "store",
            "component",
            "page",
            "composable",
            "federation",
            "boot",
            "router",
            "database",
            "other",
          ])
          .optional(),
        compact: z.boolean().default(true),
      },
      annotations: { title: "Search Code", readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, repo, language, layer, compact }) => {
      const result = await traceToolCall(
        "searchCode",
        { query, repo, language, layer, compact },
        () => executeSearchCode(query, repo, language, layer, compact),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "getArchitecture",
    {
      description:
        "Search system architecture documents, flow diagrams, and component descriptions. " +
        "Use when asked how components connect, data flows, or system design.",
      inputSchema: {
        query: z.string(),
        area: z.string().optional().describe("Filter by system area"),
        compact: z.boolean().default(true),
      },
      annotations: { title: "Get Architecture", readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, area, compact }) => {
      const result = await traceToolCall("getArchitecture", { query, area, compact }, () =>
        executeGetArchitecture(query, area, compact),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "searchSchemas",
    {
      description:
        "Search database schemas, table definitions, and column descriptions. " +
        "Use when asked about database tables, columns, or relationships.",
      inputSchema: {
        query: z.string(),
        tableName: z.string().optional().describe("Filter by exact table name"),
        compact: z.boolean().default(true),
      },
      annotations: { title: "Search Schemas", readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, tableName, compact }) => {
      const result = await traceToolCall("searchSchemas", { query, tableName, compact }, () =>
        executeSearchSchemas(query, tableName, compact),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "searchReviews",
    {
      description:
        "Search nightly code review notes from recent merges. " +
        "Use when asked about recent changes, what was reviewed, or convention violations found.",
      inputSchema: {
        query: z.string(),
        severity: z.enum(["info", "warning", "critical"]).optional(),
        category: z.enum(["convention", "bug", "security", "pattern", "architecture"]).optional(),
        since: z.string().optional().describe("Only reviews from this date onward (ISO date)"),
        compact: z.boolean().default(true),
      },
      annotations: { title: "Search Reviews", readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, severity, category, since, compact }) => {
      const result = await traceToolCall(
        "searchReviews",
        { query, severity, category, since, compact },
        () => executeSearchReviews(query, severity, category, since, compact),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "getTestSuggestions",
    {
      description:
        "Get AI-generated test suggestions for recently changed code. " +
        "Use when asked to write tests for recent merges.",
      inputSchema: {
        query: z.string(),
        language: z.enum(["java", "typescript", "vue"]).optional(),
        since: z.string().optional().describe("Only suggestions from this date onward (ISO date)"),
        compact: z.boolean().default(true),
      },
      annotations: { title: "Get Test Suggestions", readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, language, since, compact }) => {
      const result = await traceToolCall(
        "getTestSuggestions",
        { query, language, since, compact },
        () => executeGetTestSuggestions(query, language, since, compact),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "getNightlySummary",
    {
      description:
        "Get a consolidated morning briefing from the nightly intelligence pipeline. " +
        "Use at the start of a work session to understand what changed overnight.",
      inputSchema: {
        daysBack: z.number().default(1).describe("How many days back to summarize"),
      },
      annotations: { title: "Get Nightly Summary", readOnlyHint: true, openWorldHint: false },
    },
    async ({ daysBack }) => {
      const result = await traceToolCall("getNightlySummary", { daysBack }, () =>
        executeGetNightlySummary(daysBack),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "getChangeSummary",
    {
      description:
        "Get a summary of what changed since a specific date or time period. " +
        "Use when catching up after time away: 'what did I miss this week?'",
      inputSchema: {
        since: z
          .string()
          .default("1d")
          .describe("How far back: '1d', '3d', '7d', '2w', '1m', or ISO date"),
        area: z.string().optional().describe("Focus on a specific code area"),
      },
      annotations: { title: "Get Change Summary", readOnlyHint: true, openWorldHint: false },
    },
    async ({ since, area }) => {
      const result = await traceToolCall("getChangeSummary", { since, area }, () =>
        executeGetChangeSummary(since, area),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "getFileContext",
    {
      description:
        "Get development context for a file before modifying it: conventions, recent review findings, and dependency info in one call. " +
        "Call this when starting work on an unfamiliar file, a file with review history, or before refactoring. " +
        "Skip for config files, generated files, or trivially small files you just created. " +
        "Replaces calling searchStandards + searchReviews individually.",
      inputSchema: {
        filePath: z.string().describe("Relative file path, e.g. 'src/mastra/tools/search-code.ts'"),
        scope: z
          .enum(["conventions", "reviews", "dependencies", "all"])
          .default("all")
          .describe(
            "Which context sections to fetch. " +
              "Use 'conventions' (~1s) when you only need naming/pattern guidance. " +
              "Use 'reviews' (~1s) to check if a file has known past violations before touching it. " +
              "Use 'dependencies' (~1s) before refactoring to see who imports this file. " +
              "Use 'all' (default, ~2s) the first time you work on any file.",
          ),
      },
      annotations: { title: "Get File Context", readOnlyHint: true, openWorldHint: false },
    },
    async ({ filePath, scope }) => {
      const result = await traceToolCall("getFileContext", { filePath, scope }, () =>
        executeGetFileContext(filePath, scope),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "validateCode",
    {
      description:
        "Validate code against your team's indexed conventions before committing. " +
        "Returns { validated, pass, violations[] }. " +
        "IMPORTANT: Check validated:true before trusting pass:true — when validated:false, " +
        "the check was skipped (empty standards collection or LLM error) and pass:true means nothing. " +
        "Note: makes an LLM call (~3-5 seconds). For reading conventions without validation, use searchStandards.",
      inputSchema: {
        code: z.string().max(10000).describe("The code snippet to validate"),
        filePath: z
          .string()
          .describe("File path for context (determines language and relevant conventions)"),
        language: z.enum(["java", "typescript", "vue", "sql"]).optional(),
      },
      annotations: { title: "Validate Code", readOnlyHint: true, openWorldHint: false },
    },
    async ({ code, filePath, language }) => {
      const result = await traceToolCall("validateCode", { filePath, language }, () =>
        executeValidateCode(code, filePath, language),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "getImpactAnalysis",
    {
      description:
        "Trace dependency impact for a file, function, class, or table using the graph layer. " +
        "Returns all code that directly or transitively depends on the target. " +
        "Use before refactoring to understand blast radius. " +
        "Returns available: false if graph features are not configured (NEO4J_URI not set).",
      inputSchema: {
        target: z.string().describe("File path, function name, class name, or table name"),
        targetType: z.enum(["file", "function", "class", "table"]),
        depth: z.number().min(1).max(3).default(2).describe("Traversal depth (1-3)"),
        repo: z.string().optional().describe("Filter by repo name. Omit to search all repos."),
      },
      annotations: { title: "Get Impact Analysis", readOnlyHint: true, openWorldHint: false },
    },
    async ({ target, targetType, depth, repo }) => {
      const result = await traceToolCall(
        "getImpactAnalysis",
        { target, targetType, depth, repo },
        () => executeGetImpactAnalysis(target, targetType, depth ?? 2, repo),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
}
