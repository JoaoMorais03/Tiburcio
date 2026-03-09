// lib/model-provider.ts — Provider-agnostic model factory.
// MODEL_PROVIDER=ollama → native Ollama API via ollama-ai-provider
// MODEL_PROVIDER=openai-compatible → any OpenAI-compatible endpoint (vLLM, OpenRouter, etc.)

import { createOpenAI } from "@ai-sdk/openai";
import type { EmbeddingModelV3, LanguageModelV3 } from "@ai-sdk/provider";
import { ollama } from "ollama-ai-provider";

import { env } from "../config/env.js";

function createOpenAICompatible() {
  return createOpenAI({
    baseURL: env.INFERENCE_BASE_URL ?? "",
    apiKey: env.INFERENCE_API_KEY ?? "not-needed",
  });
}

export function getChatModel(): LanguageModelV3 {
  if (env.MODEL_PROVIDER === "ollama") {
    return ollama(env.OLLAMA_CHAT_MODEL) as unknown as LanguageModelV3;
  }
  // Use .chat() to force Chat Completions API — openai() defaults to Responses API
  // in AI SDK v5+, which OpenRouter/vLLM/etc. don't support.
  return createOpenAICompatible().chat(env.INFERENCE_MODEL ?? "") as unknown as LanguageModelV3;
}

export function getEmbeddingModel(): EmbeddingModelV3 {
  if (env.MODEL_PROVIDER === "ollama") {
    return ollama.embedding(env.OLLAMA_EMBEDDING_MODEL) as unknown as EmbeddingModelV3;
  }
  return createOpenAICompatible().embedding(
    env.INFERENCE_EMBEDDING_MODEL ?? "",
  ) as unknown as EmbeddingModelV3;
}
