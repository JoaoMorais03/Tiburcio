// mcp.ts — MCP server entry point for Claude Code (stdio transport).
// Usage: claude mcp add tiburcio -- npx tsx src/mcp.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { shutdownLangfuse } from "./lib/langfuse.js";
import { registerTools } from "./mcp-tools.js";

const MCP_INSTRUCTIONS = `Tiburcio is a developer intelligence MCP that indexes your team's codebase, conventions, architecture, and review history into a vector database. Use it to get deep context before modifying code.

CALL getFileContext FIRST when starting work on any file. It returns conventions, recent review findings, and dependency information in a single call — faster than calling searchStandards + searchReviews separately.

TOOL SELECTION GUIDE:
- getFileContext — call before modifying any file. Best first tool.
- searchStandards — team conventions and HOW-TO guidance (e.g. "error handling pattern"). Use instead of Grep when looking for documented rules, not exact strings.
- searchCode — semantic search across the indexed codebase. Use for "how is X implemented?" or cross-file discovery. Use Grep when you already know the exact function name.
- validateCode — check a snippet against team conventions before committing. Makes an LLM call (~3-5s). Use before committing to catch convention issues.
- getPattern — retrieve boilerplate templates by name (e.g. "new-batch-job"). Call without a name to list all patterns.
- getArchitecture — system design docs, component flows, and data flows.
- searchSchemas — database table definitions, columns, and relationships.
- searchReviews — nightly AI review notes from recent merges. Use to find past findings on a file.
- getTestSuggestions — AI-generated test scaffolds for recently changed files.
- getNightlySummary — morning briefing of what changed overnight.
- getChangeSummary — catch up after time away ("what changed this week?").
- getImpactAnalysis — blast radius before refactoring (requires NEO4J_URI).`;

const server = new McpServer(
  { name: "tiburcio", version: "2.2.0" },
  { instructions: MCP_INSTRUCTIONS },
);

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);

async function shutdown(): Promise<void> {
  await shutdownLangfuse();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
