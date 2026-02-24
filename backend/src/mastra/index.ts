// mastra/index.ts — Central Mastra instance (agents, observability, vectors).

import { Mastra } from "@mastra/core";
import { LangfuseExporter } from "@mastra/langfuse";
import { Observability } from "@mastra/observability";

import { env } from "../config/env.js";
import { chatAgent } from "./agents/chat-agent.js";
import { codeReviewAgent } from "./agents/code-review-agent.js";
import { qdrant } from "./infra.js";
import { nightlyReviewWorkflow } from "./workflows/nightly-review.js";

export { qdrant } from "./infra.js";

const observability =
  env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY
    ? new Observability({
        configs: {
          langfuse: {
            serviceName: "tiburcio",
            exporters: [
              new LangfuseExporter({
                publicKey: env.LANGFUSE_PUBLIC_KEY,
                secretKey: env.LANGFUSE_SECRET_KEY,
                baseUrl: env.LANGFUSE_BASE_URL,
              }),
            ],
          },
        },
      })
    : undefined;

export const mastra = new Mastra({
  agents: { chatAgent, codeReviewAgent },
  vectors: { qdrant },
  workflows: { nightlyReviewWorkflow },
  ...(observability ? { observability } : {}),
});
