// server.ts — Hono web server with Mastra agent, Pino logging,
// Redis rate limiting, SSE streaming, and background jobs.

import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { MastraServer } from "@mastra/hono";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import { cors } from "hono/cors";
import type { JwtVariables } from "hono/jwt";
import { verify } from "hono/jwt";
import { pinoLogger } from "hono-pino";

import { env, getRepoConfigs } from "./config/env.js";
import { logger } from "./config/logger.js";
import { redis } from "./config/redis.js";
import { connection, db } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import { indexQueue, scheduleNightlyJobs, startIndexWorker } from "./jobs/queue.js";
import { mastra, qdrant } from "./mastra/index.js";
import { authLimiter, chatLimiter, globalLimiter } from "./middleware/rate-limiter.js";
import adminRouter from "./routes/admin.js";
import authRouter from "./routes/auth.js";
import chatRouter from "./routes/chat.js";

const app = new Hono<{ Variables: JwtVariables }>();

// --- Middleware ---

app.use("*", pinoLogger({ pino: logger }));
app.use("*", bodyLimit({ maxSize: 1024 * 1024 })); // 1MB max body
app.use(
  "*",
  cors({
    origin: env.CORS_ORIGINS.split(","),
    allowMethods: ["GET", "POST", "PUT", "DELETE"],
    allowHeaders: ["Content-Type"],
    credentials: true,
  }),
);

// Cookie-based JWT auth middleware (reads httpOnly cookie instead of Bearer header)
const cookieAuth = async (
  c: Parameters<Parameters<typeof app.use>[1]>[0],
  next: () => Promise<void>,
) => {
  const token = getCookie(c, "token");
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  try {
    const payload = await verify(token, env.JWT_SECRET, "HS256");
    c.set("jwtPayload", payload);
    return next();
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
};

app.use("/api/*", globalLimiter);
app.use("/api/auth/*", authLimiter);
app.use("/api/chat/*", cookieAuth);
app.use("/api/chat/*", chatLimiter);
app.use("/api/admin/*", cookieAuth);

// --- Routes ---

app.route("/api/auth", authRouter);
app.route("/api/chat", chatRouter);
app.route("/api/admin", adminRouter);

app.get("/api/health", async (c) => {
  const checks = { database: false, redis: false, qdrant: false };

  try {
    await db.execute(sql`SELECT 1`);
    checks.database = true;
  } catch {}

  try {
    await redis.ping();
    checks.redis = true;
  } catch {}

  try {
    await qdrant.listIndexes();
    checks.qdrant = true;
  } catch {}

  const healthy = checks.database && checks.redis && checks.qdrant;

  // Only return service status and component availability — no internal
  // technology details (model names, providers, etc.) on a public endpoint.
  return c.json(
    {
      status: healthy ? "ok" : "degraded",
      checks,
      timestamp: new Date().toISOString(),
    },
    healthy ? 200 : 503,
  );
});

app.get("/", (c) => c.json({ name: "Tiburcio Backend", version: "1.1.0" }));

// --- MastraServer ---
// Protect Mastra-managed routes (agent invocation, tool execution, workflows)
// behind JWT auth so they are not publicly accessible.
app.use("/api/mastra/*", cookieAuth);

const mastraServer = new MastraServer({ app, mastra });

// --- Startup + Shutdown ---

let httpServer: ServerType;
let indexWorker: Awaited<ReturnType<typeof startIndexWorker>> | undefined;

async function start(): Promise<void> {
  await runMigrations();
  await mastraServer.init();

  indexWorker = startIndexWorker();
  await scheduleNightlyJobs();

  // Embedding model migration: if the model changed, drop all collections
  // so they get re-indexed with the new embedding dimensions/space.
  try {
    const prevModel = await redis.get("tiburcio:embedding-model");
    if (prevModel && prevModel !== env.EMBEDDING_MODEL) {
      logger.warn(
        { previous: prevModel, current: env.EMBEDDING_MODEL },
        "Embedding model changed — dropping all collections for re-indexing",
      );
      const collections = await qdrant.listIndexes();
      for (const name of collections) {
        await qdrant.deleteIndex({ indexName: name });
      }
    }
    await redis.set("tiburcio:embedding-model", env.EMBEDDING_MODEL);
  } catch (err) {
    logger.warn({ err }, "Could not check embedding model migration");
  }

  // Auto-index missing collections on startup.
  // Checks each collection individually so that:
  //  - First boot: all collections get indexed
  //  - Restart after partial failure: only missing ones are re-queued
  //  - CODEBASE_REPOS added later: codebase gets indexed on next restart
  try {
    const collections = await qdrant.listIndexes();
    const existing = new Set(collections);

    if (!existing.has("standards")) {
      logger.info("Missing 'standards' collection — queuing indexing");
      await indexQueue.add("index-standards", {} as Record<string, never>, {
        jobId: "init-standards",
      });
    }
    if (!existing.has("architecture") || !existing.has("schemas")) {
      logger.info("Missing 'architecture'/'schemas' collection — queuing indexing");
      await indexQueue.add("index-architecture", {} as Record<string, never>, {
        jobId: "init-architecture",
      });
    }
    const repos = getRepoConfigs();
    if (!existing.has("code-chunks") && repos.length > 0) {
      logger.info(
        { repos: repos.map((r) => r.name) },
        "Missing 'code-chunks' collection — queuing full codebase indexing (this may take a while)",
      );
      await indexQueue.add("index-codebase", {} as Record<string, never>, {
        jobId: "init-codebase",
      });
    }
  } catch (err) {
    logger.warn({ err }, "Could not check Qdrant for auto-indexing");
  }

  httpServer = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    logger.info({ port: info.port }, "Tiburcio backend running");
  });
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down gracefully...");
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 30_000).unref();

  httpServer?.close();
  await indexWorker?.close().catch(() => {});
  await redis.quit().catch(() => {});
  await connection.end().catch(() => {});

  logger.info("All resources closed");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

start().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
