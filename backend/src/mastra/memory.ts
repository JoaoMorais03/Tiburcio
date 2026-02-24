// mastra/memory.ts — Agent memory with semantic recall, working memory, and observational compression.

import { ModelRouterEmbeddingModel } from "@mastra/core/llm";
import { Memory } from "@mastra/memory";
import { PgVector, PostgresStore } from "@mastra/pg";

import { env } from "../config/env.js";

export const memory = new Memory({
  storage: new PostgresStore({
    id: "tiburcio-memory",
    connectionString: env.DATABASE_URL,
  }),
  vector: new PgVector({
    id: "tiburcio-memory-vector",
    connectionString: env.DATABASE_URL,
  }),
  embedder: new ModelRouterEmbeddingModel({
    providerId: "openrouter",
    modelId: env.EMBEDDING_MODEL,
    url: "https://openrouter.ai/api/v1",
    apiKey: env.OPENROUTER_API_KEY,
  }),
  options: {
    lastMessages: 20,
    semanticRecall: {
      topK: 5,
      messageRange: 2,
    },
    workingMemory: {
      enabled: true,
      template: `# User Profile
- Name:
- Expertise Level:
- Communication Style:

# Project Context
- Areas Explored:
- Questions Answered:
- Current Focus:
- Pending Topics:`,
    },
    observationalMemory: {
      model: `openrouter:${env.OPENROUTER_MODEL}`,
      scope: "thread",
    },
  },
});
