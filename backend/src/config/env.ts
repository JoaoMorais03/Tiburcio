// config/env.ts — Zod-validated environment variables.

import { config } from "dotenv";
import { z } from "zod/v4";

config({ path: "../.env" });

export const envSchema = z.object({
  DATABASE_URL: z.string(),

  REDIS_URL: z.string().default("redis://localhost:6379"),

  QDRANT_URL: z.string().default("http://localhost:6333"),

  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().default("minimax/minimax-m2.5"),
  OPENROUTER_PROVIDER: z.string().default("together"),
  EMBEDDING_MODEL: z.string().default("qwen/qwen3-embedding-8b"),
  EMBEDDING_PROVIDER: z.string().default("nebius"),

  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().optional(),

  // Multi-repo codebase indexing. Format: name:path:branch (comma-separated).
  // Single repo:  CODEBASE_REPOS=myproject:/codebase:develop
  // Multi-repo:   CODEBASE_REPOS=api:/codebase/api:develop,ui:/codebase/ui:develop
  CODEBASE_REPOS: z.string().optional(),

  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters (use: openssl rand -base64 32)"),

  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:5174"),

  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const env = envSchema.parse(process.env);

export interface RepoConfig {
  name: string;
  path: string;
  branch: string;
}

/** Parse CODEBASE_REPOS into a list of repo configs. Returns [] if not set. */
export function getRepoConfigs(): RepoConfig[] {
  if (!env.CODEBASE_REPOS) return [];
  return env.CODEBASE_REPOS.split(",").map((entry) => {
    const parts = entry.trim().split(":");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new Error(`Invalid CODEBASE_REPOS entry: "${entry.trim()}". Format: name:path:branch`);
    }
    return { name: parts[0], path: parts[1], branch: parts[2] };
  });
}
