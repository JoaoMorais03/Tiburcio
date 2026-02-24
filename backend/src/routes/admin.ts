// routes/admin.ts — Admin endpoints (reindex triggers). Requires isAdmin role.

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { JwtVariables } from "hono/jwt";

import { logger } from "../config/logger.js";
import { db } from "../db/connection.js";
import { users } from "../db/schema.js";
import type { IndexJobName } from "../jobs/queue.js";
import { indexQueue } from "../jobs/queue.js";

const adminRouter = new Hono<{ Variables: JwtVariables }>();

const VALID_TARGETS: IndexJobName[] = [
  "index-standards",
  "index-codebase",
  "index-architecture",
  "nightly-review",
];

// Middleware: verify the authenticated user has isAdmin flag
adminRouter.use("/*", async (c, next) => {
  const { sub: userId } = c.get("jwtPayload");
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user?.isAdmin) {
    return c.json({ error: "Forbidden" }, 403);
  }
  return next();
});

adminRouter.post("/reindex", async (c) => {
  const jobs = await Promise.all(
    VALID_TARGETS.map((name) => indexQueue.add(name, {} as Record<string, never>)),
  );

  const jobIds = jobs.map((j) => ({ name: j.name, id: j.id }));
  logger.info({ jobIds }, "Enqueued reindex jobs");

  return c.json({ queued: jobIds });
});

adminRouter.get("/reindex/status", async (c) => {
  const [waiting, active, completed, failed] = await Promise.all([
    indexQueue.getWaitingCount(),
    indexQueue.getActiveCount(),
    indexQueue.getCompletedCount(),
    indexQueue.getFailedCount(),
  ]);

  return c.json({ waiting, active, completed, failed });
});

export default adminRouter;
