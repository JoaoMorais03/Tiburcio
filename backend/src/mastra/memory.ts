// mastra/memory.ts — Agent memory with semantic recall, working memory, and observational compression.
// Uses provider-agnostic models from infra.ts.

import { Memory } from "@mastra/memory";
import { PgVector, PostgresStore } from "@mastra/pg";

import { env } from "../config/env.js";
import { embeddingModel } from "./infra.js";

const observationalModel =
  env.MODEL_PROVIDER === "ollama"
    ? `ollama:${env.OLLAMA_CHAT_MODEL}`
    : `openrouter:${env.OPENROUTER_MODEL}`;

export const memory = new Memory({
  storage: new PostgresStore({
    id: "tiburcio-memory",
    connectionString: env.DATABASE_URL,
  }),
  vector: new PgVector({
    id: "tiburcio-memory-vector",
    connectionString: env.DATABASE_URL,
  }),
  embedder: embeddingModel,
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
      model: observationalModel,
      scope: "thread",
    },
  },
});
