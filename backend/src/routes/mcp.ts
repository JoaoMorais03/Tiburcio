// routes/mcp.ts — MCP HTTP/SSE transport for team deployment.
// Authentication: Bearer token via TEAM_API_KEY env var.
//
// Developer setup:
//   claude mcp add tiburcio --transport sse \
//     --url http://localhost:3000/mcp/sse \
//     --header "Authorization:Bearer <team-api-key>"

import type { HttpBindings } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Hono } from "hono";
import { z } from "zod/v4";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { executeGetArchitecture } from "../mastra/tools/get-architecture.js";
import { executeGetChangeSummary } from "../mastra/tools/get-change-summary.js";
import { executeGetNightlySummary } from "../mastra/tools/get-nightly-summary.js";
import { executeGetPattern } from "../mastra/tools/get-pattern.js";
import { executeGetTestSuggestions } from "../mastra/tools/get-test-suggestions.js";
import { executeSearchCode } from "../mastra/tools/search-code.js";
import { executeSearchReviews } from "../mastra/tools/search-reviews.js";
import { executeSearchSchemas } from "../mastra/tools/search-schemas.js";
import { executeSearchStandards } from "../mastra/tools/search-standards.js";

const mcpRouter = new Hono<{ Bindings: HttpBindings }>();

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "tiburcio", version: "2.1.0" });

  server.registerTool(
    "searchStandards",
    {
      description:
        "Search your team's coding standards, conventions, and best practices. " +
        "Use when you need to know HOW the team does something.",
      inputSchema: {
        query: z.string().describe("What to search for"),
        category: z.enum(["backend", "frontend", "database", "integration"]).optional(),
        compact: z.boolean().default(true),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, category, compact }) => {
      const result = await executeSearchStandards(query, category, compact);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "getPattern",
    {
      description:
        "Retrieve a specific code pattern or boilerplate template by name. " +
        "Omit name to list available patterns.",
      inputSchema: {
        name: z.string().optional().describe("Pattern name to retrieve"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ name }) => {
      const result = await executeGetPattern(name);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "searchCode",
    {
      description:
        "Search real production code using hybrid search (semantic + keyword matching). " +
        "Returns enriched results with symbolName, classContext, and line ranges.",
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
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, repo, language, layer, compact }) => {
      const result = await executeSearchCode(query, repo, language, layer, compact);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "getArchitecture",
    {
      description:
        "Search system architecture documents, flow diagrams, and component descriptions.",
      inputSchema: {
        query: z.string(),
        area: z.string().optional().describe("Filter by system area"),
        compact: z.boolean().default(true),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, area, compact }) => {
      const result = await executeGetArchitecture(query, area, compact);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "searchSchemas",
    {
      description: "Search database schemas, table definitions, and column descriptions.",
      inputSchema: {
        query: z.string(),
        tableName: z.string().optional().describe("Filter by exact table name"),
        compact: z.boolean().default(true),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, tableName, compact }) => {
      const result = await executeSearchSchemas(query, tableName, compact);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "searchReviews",
    {
      description: "Search nightly code review notes from recent merges.",
      inputSchema: {
        query: z.string(),
        severity: z.enum(["info", "warning", "critical"]).optional(),
        category: z
          .enum(["convention", "bug", "security", "pattern", "architecture", "change-summary"])
          .optional(),
        since: z.string().optional().describe("Only reviews from this date onward (ISO date)"),
        compact: z.boolean().default(true),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, severity, category, since, compact }) => {
      const result = await executeSearchReviews(query, severity, category, since, compact);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "getTestSuggestions",
    {
      description: "Get AI-generated test suggestions for recently changed code.",
      inputSchema: {
        query: z.string(),
        language: z.enum(["java", "typescript", "vue"]).optional(),
        since: z.string().optional().describe("Only suggestions from this date onward (ISO date)"),
        compact: z.boolean().default(true),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, language, since, compact }) => {
      const result = await executeGetTestSuggestions(query, language, since, compact);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "getNightlySummary",
    {
      description: "Get a consolidated morning briefing from the nightly intelligence pipeline.",
      inputSchema: {
        daysBack: z.number().default(1).describe("How many days back to summarize"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ daysBack }) => {
      const result = await executeGetNightlySummary(daysBack);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "getChangeSummary",
    {
      description:
        "Get a summary of what changed since a specific date or time period. " +
        "Use when catching up after time away.",
      inputSchema: {
        since: z
          .string()
          .default("1d")
          .describe("How far back: '1d', '3d', '7d', '2w', '1m', or ISO date"),
        area: z.string().optional().describe("Focus on a specific code area"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ since, area }) => {
      const result = await executeGetChangeSummary(since, area);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  return server;
}

const activeTransports = new Map<string, SSEServerTransport>();

// Bearer token authentication middleware
mcpRouter.use("/*", async (c, next) => {
  if (!env.TEAM_API_KEY) {
    logger.warn("MCP HTTP endpoint accessed but TEAM_API_KEY is not configured");
    return c.json({ error: "MCP HTTP transport not configured — set TEAM_API_KEY" }, 503);
  }
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (authHeader.slice(7) !== env.TEAM_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

// SSE connection endpoint
mcpRouter.get("/sse", async (c) => {
  const res = c.env.outgoing;
  const transport = new SSEServerTransport("/mcp/message", res);
  const sessionId = transport.sessionId;
  activeTransports.set(sessionId, transport);

  const server = createMcpServer();
  await server.connect(transport);

  res.on("close", () => {
    activeTransports.delete(sessionId);
  });

  // SSEServerTransport takes over the response — return an empty Response to satisfy Hono
  return new Response(null, { status: 200 });
});

// Message endpoint
mcpRouter.post("/message", async (c) => {
  const sessionId = c.req.query("sessionId") ?? "";
  const transport = activeTransports.get(sessionId);
  if (!transport) {
    return c.json({ error: "Session not found" }, 404);
  }
  const req = c.env.incoming;
  const res = c.env.outgoing;
  await transport.handlePostMessage(req, res);
  return new Response(null, { status: 200 });
});

export default mcpRouter;
