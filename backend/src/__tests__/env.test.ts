// Tests for config/env.ts — validates the REAL Zod schema (not a copy).
// env.ts calls envSchema.parse(process.env) at module load, so required vars
// must be set BEFORE the dynamic import (top-level, not in beforeAll).

import { afterAll, describe, expect, it } from "vitest";

const originalEnv = { ...process.env };

// Must run before import — env.ts parses on load (no .env file in CI)
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
process.env.JWT_SECRET = "a-test-secret-that-is-at-least-32-characters!!";

const { envSchema } = await import("../config/env.js");

afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

const validEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  OPENROUTER_API_KEY: "sk-or-v1-test",
  JWT_SECRET: "a-secret-that-is-at-least-32-chars-long!!",
};

describe("envSchema", () => {
  it("parses a valid minimal env with correct defaults", () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3000);
      expect(result.data.NODE_ENV).toBe("development");
      expect(result.data.REDIS_URL).toBe("redis://localhost:6379");
      expect(result.data.QDRANT_URL).toBe("http://localhost:6333");
      expect(result.data.OPENROUTER_MODEL).toBe("minimax/minimax-m2.5");
      expect(result.data.EMBEDDING_MODEL).toBe("qwen/qwen3-embedding-8b");
      expect(result.data.CODEBASE_BRANCH).toBe("develop");
      expect(result.data.CORS_ORIGINS).toBe("http://localhost:5173,http://localhost:5174");
    }
  });

  it("fails when DATABASE_URL is missing", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      DATABASE_URL: undefined,
    });
    expect(result.success).toBe(false);
  });

  it("fails when OPENROUTER_API_KEY is empty", () => {
    const result = envSchema.safeParse({ ...validEnv, OPENROUTER_API_KEY: "" });
    expect(result.success).toBe(false);
  });

  it("fails when JWT_SECRET is shorter than 32 characters", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      JWT_SECRET: "too-short",
    });
    expect(result.success).toBe(false);
  });

  it("coerces PORT to number", () => {
    const result = envSchema.safeParse({ ...validEnv, PORT: "8080" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(8080);
    }
  });

  it("rejects invalid NODE_ENV", () => {
    const result = envSchema.safeParse({ ...validEnv, NODE_ENV: "staging" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid CODEBASE_BRANCH characters", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      CODEBASE_BRANCH: "branch;rm -rf /",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid CODEBASE_BRANCH patterns", () => {
    for (const branch of ["main", "develop", "feature/auth-v2", "release/1.0.0"]) {
      const result = envSchema.safeParse({
        ...validEnv,
        CODEBASE_BRANCH: branch,
      });
      expect(result.success).toBe(true);
    }
  });

  it("allows optional Langfuse keys", () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.LANGFUSE_PUBLIC_KEY).toBeUndefined();
      expect(result.data.LANGFUSE_SECRET_KEY).toBeUndefined();
    }
  });
});
