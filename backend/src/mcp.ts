// mcp.ts — MCP server entry point for Claude Code (stdio transport).
// Usage: claude mcp add tiburcio -- npx tsx src/mcp.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerTools } from "./mcp-tools.js";

const server = new McpServer({ name: "tiburcio", version: "2.1.0" });

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
