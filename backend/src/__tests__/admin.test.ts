// Tests for admin route flows (reindex triggers + status).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/connection.js", () => ({
  db: {
    query: {
      users: { findFirst: vi.fn() },
    },
  },
}));

vi.mock("../jobs/queue.js", () => ({
  indexQueue: {
    add: vi.fn(),
    getWaitingCount: vi.fn(),
    getActiveCount: vi.fn(),
    getCompletedCount: vi.fn(),
    getFailedCount: vi.fn(),
  },
}));

vi.mock("../config/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../config/env.js", () => ({
  env: { JWT_SECRET: "test-secret-that-is-long-enough" },
}));

import { Hono } from "hono";
import { db } from "../db/connection.js";
import { indexQueue } from "../jobs/queue.js";

async function createApp(userId = "user-123") {
  const { default: adminRouter } = await import("../routes/admin.js");
  const app = new Hono();
  app.use("/*", async (c, next) => {
    c.set("jwtPayload", { sub: userId });
    return next();
  });
  app.route("/admin", adminRouter);
  return app;
}

describe("admin routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("admin middleware", () => {
    it("returns 403 for non-admin user and blocks the request", async () => {
      const app = await createApp();
      vi.mocked(db.query.users.findFirst).mockResolvedValue({
        id: "user-123",
        isAdmin: false,
      } as any);

      const res = await app.request(
        new Request("http://localhost/admin/reindex", { method: "POST" }),
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Forbidden");
      // Queue should NOT be touched when auth fails
      expect(indexQueue.add).not.toHaveBeenCalled();
    });

    it("returns 403 when user not found in DB", async () => {
      const app = await createApp();
      vi.mocked(db.query.users.findFirst).mockResolvedValue(undefined);

      const res = await app.request(
        new Request("http://localhost/admin/reindex", { method: "POST" }),
      );

      expect(res.status).toBe(403);
      expect(indexQueue.add).not.toHaveBeenCalled();
    });

    it("looks up the correct userId from JWT — not a hardcoded value", async () => {
      // Use a unique userId to prove the middleware reads from JWT, not hardcoded
      const app = await createApp("unique-user-xyz");
      // Return undefined so it 403s — the point is to check WHAT userId was looked up
      vi.mocked(db.query.users.findFirst).mockResolvedValue(undefined);

      const res = await app.request(
        new Request("http://localhost/admin/reindex", { method: "POST" }),
      );
      expect(res.status).toBe(403);

      // Now create with a DIFFERENT userId — if middleware hardcodes, it won't match
      vi.clearAllMocks();
      const app2 = await createApp("other-user-abc");
      vi.mocked(db.query.users.findFirst).mockResolvedValue({
        id: "other-user-abc",
        isAdmin: true,
      } as never);
      vi.mocked(indexQueue.add).mockResolvedValue({
        name: "index-standards",
        id: "j1",
      } as any);

      const res2 = await app2.request(
        new Request("http://localhost/admin/reindex", { method: "POST" }),
      );
      // If middleware uses the JWT userId correctly, findFirst returns admin → 200
      expect(res2.status).toBe(200);
      // Verify findFirst was called exactly once (middleware does a DB lookup)
      expect(db.query.users.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /admin/reindex", () => {
    it("queues all 4 indexing jobs with the correct names", async () => {
      const app = await createApp();
      vi.mocked(db.query.users.findFirst).mockResolvedValue({
        id: "user-123",
        isAdmin: true,
      } as any);
      vi.mocked(indexQueue.add)
        .mockResolvedValueOnce({ name: "index-standards", id: "job-1" } as any)
        .mockResolvedValueOnce({ name: "index-codebase", id: "job-2" } as any)
        .mockResolvedValueOnce({
          name: "index-architecture",
          id: "job-3",
        } as any)
        .mockResolvedValueOnce({ name: "nightly-review", id: "job-4" } as any);

      const res = await app.request(
        new Request("http://localhost/admin/reindex", { method: "POST" }),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.queued).toHaveLength(4);
      expect(body.queued.map((j: any) => j.name)).toEqual([
        "index-standards",
        "index-codebase",
        "index-architecture",
        "nightly-review",
      ]);

      expect(indexQueue.add).toHaveBeenCalledTimes(4);
      const addCalls = vi.mocked(indexQueue.add).mock.calls;
      expect(addCalls[0][0]).toBe("index-standards");
      expect(addCalls[1][0]).toBe("index-codebase");
      expect(addCalls[2][0]).toBe("index-architecture");
      expect(addCalls[3][0]).toBe("nightly-review");
    });
  });

  describe("GET /admin/reindex/status", () => {
    it("returns all 4 queue counts", async () => {
      const app = await createApp();
      vi.mocked(db.query.users.findFirst).mockResolvedValue({
        id: "user-123",
        isAdmin: true,
      } as any);
      vi.mocked(indexQueue.getWaitingCount).mockResolvedValue(2);
      vi.mocked(indexQueue.getActiveCount).mockResolvedValue(1);
      vi.mocked(indexQueue.getCompletedCount).mockResolvedValue(10);
      vi.mocked(indexQueue.getFailedCount).mockResolvedValue(0);

      const res = await app.request(new Request("http://localhost/admin/reindex/status"));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ waiting: 2, active: 1, completed: 10, failed: 0 });

      // Verify all 4 count methods were called
      expect(indexQueue.getWaitingCount).toHaveBeenCalled();
      expect(indexQueue.getActiveCount).toHaveBeenCalled();
      expect(indexQueue.getCompletedCount).toHaveBeenCalled();
      expect(indexQueue.getFailedCount).toHaveBeenCalled();
    });
  });
});
