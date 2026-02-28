// mcp.ts — MCP server entry point for Claude Code (stdio transport).
// Usage: claude mcp add tiburcio -- npx tsx src/mcp.ts

import { MCPServer } from "@mastra/mcp";
import { getArchitecture } from "./mastra/tools/get-architecture.js";
import { getChangeSummary } from "./mastra/tools/get-change-summary.js";
import { getNightlySummary } from "./mastra/tools/get-nightly-summary.js";
import { getPattern } from "./mastra/tools/get-pattern.js";
import { getTestSuggestions } from "./mastra/tools/get-test-suggestions.js";
import { searchCode } from "./mastra/tools/search-code.js";
import { searchReviews } from "./mastra/tools/search-reviews.js";
import { searchSchemas } from "./mastra/tools/search-schemas.js";
import { searchStandards } from "./mastra/tools/search-standards.js";

const server = new MCPServer({
  id: "tiburcio",
  name: "Tiburcio MCP",
  version: "2.0.0",
  tools: {
    searchStandards,
    getPattern,
    searchCode,
    getArchitecture,
    searchSchemas,
    searchReviews,
    getTestSuggestions,
    getNightlySummary,
    getChangeSummary,
  },
});

await server.startStdio();
