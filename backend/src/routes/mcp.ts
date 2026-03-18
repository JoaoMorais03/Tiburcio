// routes/mcp.ts — MCP HTTP/SSE transport for team deployment.
// Authentication: Bearer token via TEAM_API_KEY env var.
//
// Developer setup:
//   claude mcp add tiburcio --transport sse \
//     --url http://your-server:3333/mcp/sse \
//     --header "Authorization:Bearer <team-api-key>"

import { timingSafeEqual } from "node:crypto";
import type { HttpBindings } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Hono } from "hono";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { VERSION } from "../config/version.js";
import { MCP_INSTRUCTIONS, registerTools } from "../mcp-tools.js";
import { mcpLimiter } from "../middleware/rate-limiter.js";

const mcpRouter = new Hono<{ Bindings: HttpBindings }>();

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "tiburcio", version: VERSION },
    { instructions: MCP_INSTRUCTIONS },
  );
  registerTools(server);
  return server;
}

const activeTransports = new Map<string, { transport: SSEServerTransport; createdAt: number }>();

// Evict stale transports (abandoned connections that didn't send close event)
setInterval(() => {
  const maxAge = 30 * 60 * 1000; // 30 minutes
  const now = Date.now();
  for (const [id, entry] of activeTransports) {
    if (now - entry.createdAt > maxAge) activeTransports.delete(id);
  }
}, 60_000).unref();

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
  const provided = Buffer.from(authHeader.slice(7));
  const expected = Buffer.from(env.TEAM_API_KEY);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

mcpRouter.use("/*", mcpLimiter);

// SSE connection endpoint
mcpRouter.get("/sse", async (c) => {
  const res = c.env.outgoing;
  const transport = new SSEServerTransport("/mcp/message", res);
  const sessionId = transport.sessionId;
  activeTransports.set(sessionId, { transport, createdAt: Date.now() });

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
  const entry = activeTransports.get(sessionId);
  if (!entry) {
    return c.json({ error: "Session not found" }, 404);
  }
  const req = c.env.incoming;
  const res = c.env.outgoing;
  await entry.transport.handlePostMessage(req, res);
  return new Response(null, { status: 200 });
});

export default mcpRouter;
