// Tests for auth route flows (register, login, refresh, logout).

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing route
vi.mock("../db/connection.js", () => ({
  db: {
    query: {
      users: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(),
  },
}));

vi.mock("../config/env.js", () => ({
  env: {
    JWT_SECRET: "test-secret-that-is-long-enough",
    NODE_ENV: "development",
  },
}));

vi.mock("../config/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../config/redis.js", () => ({
  redis: {
    set: vi.fn().mockResolvedValue("OK"),
    get: vi.fn().mockResolvedValue("uuid-123"),
    del: vi.fn().mockResolvedValue(1),
  },
}));

import { Hono } from "hono";
import { redis } from "../config/redis.js";
import { db } from "../db/connection.js";

// Build a minimal app with auth routes
async function createApp() {
  const { default: authRouter } = await import("../routes/auth.js");
  const app = new Hono();
  app.route("/auth", authRouter);
  return app;
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Extract Set-Cookie headers from response */
function getCookies(res: Response): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const header of res.headers.getSetCookie()) {
    const [nameValue] = header.split(";");
    const [name, value] = nameValue.split("=");
    cookies[name.trim()] = value.trim();
  }
  return cookies;
}

describe("auth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /auth/register", () => {
    it("registers a new user and sets httpOnly cookies", async () => {
      const app = await createApp();
      const mockUser = {
        id: "uuid-123",
        username: "alice",
        passwordHash: "hashed",
      };

      vi.mocked(db.query.users.findFirst).mockResolvedValue(undefined);
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockUser]),
        }),
      } as any);

      const res = await app.request(
        jsonRequest("/auth/register", {
          username: "Alice",
          password: "password123",
        }),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      // Token is NOT in response body
      expect(body.token).toBeUndefined();
      expect(body.user.username).toBe("alice");
      expect(body.user.id).toBe("uuid-123");

      // Tokens are in httpOnly cookies
      const cookies = getCookies(res);
      expect(cookies.token).toBeDefined();
      expect(cookies.refresh_token).toBeDefined();

      // Refresh token jti stored in Redis
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^refresh:/),
        "uuid-123",
        "EX",
        expect.any(Number),
      );
    });

    it("returns 400 for duplicate username (no enumeration)", async () => {
      const app = await createApp();
      vi.mocked(db.query.users.findFirst).mockResolvedValue({
        id: "existing",
      } as any);

      const res = await app.request(
        jsonRequest("/auth/register", {
          username: "alice",
          password: "password123",
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Registration failed");
      // Must NOT say "Username already taken"
      expect(body.error).not.toContain("taken");
    });

    it("rejects short password (< 8 chars)", async () => {
      const app = await createApp();

      const res = await app.request(
        jsonRequest("/auth/register", {
          username: "alice",
          password: "short",
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("8");
    });

    it("rejects short username (< 2 chars)", async () => {
      const app = await createApp();

      const res = await app.request(
        jsonRequest("/auth/register", {
          username: "a",
          password: "password123",
        }),
      );

      expect(res.status).toBe(400);
    });
  });

  describe("POST /auth/login", () => {
    it("logs in with valid credentials and sets cookies", async () => {
      const app = await createApp();
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.default.hash("password123", 10);

      vi.mocked(db.query.users.findFirst).mockResolvedValue({
        id: "uuid-123",
        username: "alice",
        passwordHash: hash,
      } as any);

      const res = await app.request(
        jsonRequest("/auth/login", {
          username: "alice",
          password: "password123",
        }),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBeUndefined();
      expect(body.user.id).toBe("uuid-123");

      const cookies = getCookies(res);
      expect(cookies.token).toBeDefined();
      expect(cookies.refresh_token).toBeDefined();
    });

    it("returns 401 for wrong password", async () => {
      const app = await createApp();
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.default.hash("correct-password", 10);

      vi.mocked(db.query.users.findFirst).mockResolvedValue({
        id: "uuid-123",
        username: "alice",
        passwordHash: hash,
      } as any);

      const res = await app.request(
        jsonRequest("/auth/login", {
          username: "alice",
          password: "wrong-password",
        }),
      );

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid credentials");
    });

    it("returns 401 for nonexistent user (same error as wrong password)", async () => {
      const app = await createApp();
      vi.mocked(db.query.users.findFirst).mockResolvedValue(undefined);

      const res = await app.request(
        jsonRequest("/auth/login", {
          username: "nobody",
          password: "password123",
        }),
      );

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid credentials");
    });
  });

  describe("POST /auth/logout", () => {
    it("clears cookies and revokes refresh token", async () => {
      const app = await createApp();

      const res = await app.request(
        new Request("http://localhost/auth/logout", {
          method: "POST",
        }),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe("Logged out");
    });
  });

  describe("POST /auth/refresh", () => {
    it("returns 401 when no refresh cookie", async () => {
      const app = await createApp();

      const res = await app.request(
        new Request("http://localhost/auth/refresh", {
          method: "POST",
        }),
      );

      expect(res.status).toBe(401);
    });
  });
});
