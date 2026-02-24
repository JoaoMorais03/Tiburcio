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

  CODEBASE_PATH: z.string().optional(),
  CODEBASE_BRANCH: z
    .string()
    .regex(/^[a-zA-Z0-9._/-]+$/, "Invalid branch name")
    .default("develop"),

  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters (use: openssl rand -base64 32)"),

  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:5174"),

  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const env = envSchema.parse(process.env);
