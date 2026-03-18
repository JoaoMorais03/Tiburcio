// mcp.ts — MCP server entry point for Claude Code (stdio transport).
// Usage: claude mcp add tiburcio -- npx tsx src/mcp.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { VERSION } from "./config/version.js";
import { shutdownLangfuse } from "./lib/langfuse.js";
import { MCP_INSTRUCTIONS, registerTools } from "./mcp-tools.js";

const server = new McpServer(
  { name: "tiburcio", version: VERSION },
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
