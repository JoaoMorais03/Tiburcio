// config/env.ts — Zod-validated environment variables.
// MODEL_PROVIDER selects between local Ollama and cloud OpenRouter inference.

import { config } from "dotenv";
import { z } from "zod/v4";

config({ path: "../.env" });

const baseSchema = z.object({
  DATABASE_URL: z.string(),

  REDIS_URL: z.string().default("redis://localhost:6379"),

  QDRANT_URL: z.string().default("http://localhost:6333"),

  // Model provider: "ollama" for local inference, "openrouter" for cloud
  MODEL_PROVIDER: z.enum(["ollama", "openrouter"]).default("openrouter"),

  // Ollama settings (used when MODEL_PROVIDER=ollama)
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_CHAT_MODEL: z.string().default("qwen3:8b"),
  OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),

  // OpenRouter settings (used when MODEL_PROVIDER=openrouter)
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("minimax/minimax-m2.5"),
  OPENROUTER_PROVIDER: z.string().default("together"),
  EMBEDDING_MODEL: z.string().default("qwen/qwen3-embedding-8b"),
  EMBEDDING_PROVIDER: z.string().default("nebius"),

  // Embedding vector dimensions: 768 for nomic-embed-text, 4096 for qwen3-embedding-8b.
  // Must match the chosen embedding model. Auto-defaults based on MODEL_PROVIDER.
  EMBEDDING_DIMENSIONS: z.coerce.number().optional(),

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

export const envSchema = baseSchema.refine(
  (data) =>
    data.MODEL_PROVIDER !== "openrouter" ||
    (data.OPENROUTER_API_KEY != null && data.OPENROUTER_API_KEY.length > 0),
  {
    message: "OPENROUTER_API_KEY is required when MODEL_PROVIDER is 'openrouter'",
    path: ["OPENROUTER_API_KEY"],
  },
);

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.parse(process.env) as Env;

// Auto-default EMBEDDING_DIMENSIONS based on provider when not explicitly set
if (parsed.EMBEDDING_DIMENSIONS == null) {
  parsed.EMBEDDING_DIMENSIONS = parsed.MODEL_PROVIDER === "ollama" ? 768 : 4096;
}

export const env = parsed;

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
