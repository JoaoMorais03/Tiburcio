// Tests for config/env.ts — validates the REAL Zod schema (not a copy).
// env.ts calls envSchema.parse(process.env) at module load, so required vars
// must be set BEFORE the dynamic import (top-level, not in beforeAll).

import { afterAll, afterEach, describe, expect, it } from "vitest";

const originalEnv = { ...process.env };

// Must run before import — env.ts parses on load (no .env file in CI)
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
process.env.JWT_SECRET = "a-test-secret-that-is-at-least-32-characters!!";

const { env, envSchema, getRepoConfigs } = await import("../config/env.js");

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

  it("allows optional Langfuse keys", () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.LANGFUSE_PUBLIC_KEY).toBeUndefined();
      expect(result.data.LANGFUSE_SECRET_KEY).toBeUndefined();
    }
  });

  it("accepts CODEBASE_REPOS as optional", () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.CODEBASE_REPOS).toBeUndefined();
    }
  });
});

describe("getRepoConfigs", () => {
  // Save and restore the parsed env singleton between tests
  const savedRepos = env.CODEBASE_REPOS;
  afterEach(() => {
    env.CODEBASE_REPOS = savedRepos;
  });

  it("returns empty array when CODEBASE_REPOS is not set", () => {
    env.CODEBASE_REPOS = undefined;
    expect(getRepoConfigs()).toEqual([]);
  });

  it("parses a single repo entry", () => {
    env.CODEBASE_REPOS = "myproject:/codebase:develop";
    expect(getRepoConfigs()).toEqual([{ name: "myproject", path: "/codebase", branch: "develop" }]);
  });

  it("parses multiple repo entries", () => {
    env.CODEBASE_REPOS =
      "api:/codebase/api:develop,ui:/codebase/ui:main,batch:/codebase/batch:develop";
    expect(getRepoConfigs()).toEqual([
      { name: "api", path: "/codebase/api", branch: "develop" },
      { name: "ui", path: "/codebase/ui", branch: "main" },
      { name: "batch", path: "/codebase/batch", branch: "develop" },
    ]);
  });

  it("trims whitespace from entries", () => {
    env.CODEBASE_REPOS = " api:/codebase/api:develop , ui:/codebase/ui:main ";
    const result = getRepoConfigs();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("api");
    expect(result[1].name).toBe("ui");
  });

  it("throws on malformed entry (missing branch)", () => {
    env.CODEBASE_REPOS = "api:/codebase/api";
    expect(() => getRepoConfigs()).toThrow("Invalid CODEBASE_REPOS entry");
  });

  it("throws on empty name", () => {
    env.CODEBASE_REPOS = ":/codebase:develop";
    expect(() => getRepoConfigs()).toThrow("Invalid CODEBASE_REPOS entry");
  });
});
