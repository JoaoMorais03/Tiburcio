// config/env.ts — Zod-validated environment variables.
// MODEL_PROVIDER selects between local Ollama and any OpenAI-compatible endpoint.

import { config } from "dotenv";
import { z } from "zod";

config({ path: "../.env" });

const baseSchema = z.object({
  DATABASE_URL: z.string(),

  REDIS_URL: z.string().default("redis://localhost:6379"),

  QDRANT_URL: z.string().default("http://localhost:6333"),

  // Model provider: "ollama" for local inference, "openai-compatible" for vLLM/OpenRouter/etc.
  MODEL_PROVIDER: z.enum(["ollama", "openai-compatible"]).default("ollama"),

  // Ollama settings (used when MODEL_PROVIDER=ollama)
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_CHAT_MODEL: z.string().default("qwen3:8b"),
  OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),

  // OpenAI-compatible settings (used when MODEL_PROVIDER=openai-compatible)
  INFERENCE_BASE_URL: z.string().optional(),
  INFERENCE_API_KEY: z.string().optional(),
  INFERENCE_MODEL: z.string().optional(),
  INFERENCE_EMBEDDING_MODEL: z.string().optional(),

  // Optional: override the model used for the nightly review pipeline.
  // When not set, falls back to the same model as OLLAMA_CHAT_MODEL / INFERENCE_MODEL.
  // Example: REVIEW_MODEL=qwen/qwen3-32b (larger model for better review quality)
  REVIEW_MODEL: z.string().optional(),

  // Embedding vector dimensions: 768 for nomic-embed-text, 4096 for qwen3-embedding-8b.
  // Must match the chosen embedding model. Auto-defaults based on MODEL_PROVIDER.
  EMBEDDING_DIMENSIONS: z.coerce.number().optional(),

  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().optional(),
  LANGFUSE_RECORD_IO: z.string().optional().default("true"),

  // Multi-repo codebase indexing. Format: name:path:branch (comma-separated).
  // Single repo:  CODEBASE_REPOS=myproject:/codebase:develop
  // Multi-repo:   CODEBASE_REPOS=api:/codebase/api:develop,ui:/codebase/ui:develop
  CODEBASE_REPOS: z.string().optional(),

  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters (use: openssl rand -base64 32)"),

  // Bearer token for MCP HTTP/SSE transport authentication.
  // Required when exposing MCP over HTTP for team deployment.
  TEAM_API_KEY: z
    .string()
    .min(32, "TEAM_API_KEY must be at least 32 characters (use: openssl rand -base64 32)")
    .optional(),

  // Retrieval confidence thresholds — filter low-relevance results before returning to Claude
  RETRIEVAL_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.45),
  // searchCode uses Qdrant RRF fusion scores (not cosine similarity) — much lower scale
  RETRIEVAL_CODE_SCORE_THRESHOLD: z.coerce.number().default(0.02),
  // Neo4j graph (optional — omit NEO4J_URI to disable graph features entirely)
  NEO4J_URI: z.string().optional(),
  NEO4J_PASSWORD: z.string().optional(),

  // Set to true after initial team accounts are created to prevent new self-registration.
  DISABLE_REGISTRATION: z.coerce.boolean().default(false),

  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:5174"),

  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const envSchema = baseSchema
  .refine(
    (data) =>
      data.MODEL_PROVIDER !== "openai-compatible" ||
      (data.INFERENCE_BASE_URL != null &&
        data.INFERENCE_BASE_URL.length > 0 &&
        data.INFERENCE_MODEL != null &&
        data.INFERENCE_MODEL.length > 0),
    {
      message:
        "INFERENCE_BASE_URL and INFERENCE_MODEL are required when MODEL_PROVIDER is 'openai-compatible'",
      path: ["INFERENCE_BASE_URL"],
    },
  )
  .refine(
    (data) => !data.NEO4J_URI || (data.NEO4J_PASSWORD != null && data.NEO4J_PASSWORD.length > 0),
    {
      message: "NEO4J_PASSWORD is required when NEO4J_URI is configured",
      path: ["NEO4J_PASSWORD"],
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
