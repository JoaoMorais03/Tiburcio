// routes/mcp.ts — MCP HTTP/SSE transport for team deployment.
// Exposes the same 9 tools as the stdio transport in src/mcp.ts.
// Authentication: Bearer token via TEAM_API_KEY env var.
//
// Developer setup:
//   claude mcp add tiburcio --transport sse \
//     --url http://localhost:3000/mcp/sse \
//     --header "Authorization:Bearer <team-api-key>"

import { MCPServer } from "@mastra/mcp";
import { Hono } from "hono";

import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getArchitecture } from "../mastra/tools/get-architecture.js";
import { getChangeSummary } from "../mastra/tools/get-change-summary.js";
import { getNightlySummary } from "../mastra/tools/get-nightly-summary.js";
import { getPattern } from "../mastra/tools/get-pattern.js";
import { getTestSuggestions } from "../mastra/tools/get-test-suggestions.js";
import { searchCode } from "../mastra/tools/search-code.js";
import { searchReviews } from "../mastra/tools/search-reviews.js";
import { searchSchemas } from "../mastra/tools/search-schemas.js";
import { searchStandards } from "../mastra/tools/search-standards.js";

const mcpRouter = new Hono();

const mcpServer = new MCPServer({
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

// Bearer token authentication middleware.
// Validates Authorization header against TEAM_API_KEY.
mcpRouter.use("/*", async (c, next) => {
  if (!env.TEAM_API_KEY) {
    logger.warn("MCP HTTP endpoint accessed but TEAM_API_KEY is not configured");
    return c.json({ error: "MCP HTTP transport not configured — set TEAM_API_KEY" }, 503);
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  if (token !== env.TEAM_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return next();
});

// SSE connection endpoint — clients connect here for server-sent events.
mcpRouter.get("/sse", async (c) => {
  const url = new URL(c.req.url);
  return mcpServer.startHonoSSE({
    url,
    ssePath: "/mcp/sse",
    messagePath: "/mcp/message",
    context: c,
  });
});

// Message endpoint — clients POST MCP messages here.
mcpRouter.post("/message", async (c) => {
  const url = new URL(c.req.url);
  return mcpServer.startHonoSSE({
    url,
    ssePath: "/mcp/sse",
    messagePath: "/mcp/message",
    context: c,
  });
});

export { mcpServer };
export default mcpRouter;
