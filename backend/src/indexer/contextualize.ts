// indexer/contextualize.ts — Contextual Retrieval (Anthropic technique).
// Before embedding a chunk, generate a short LLM description of what it does
// within the full file context. This context gets prepended to the embedding text,
// so the vector captures both the code AND its semantic purpose.
// Result: 49% fewer retrieval failures (Anthropic 2024 benchmark).

import { generateText } from "ai";

import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { openrouter } from "../mastra/infra.js";

const model = openrouter.chat(env.OPENROUTER_MODEL, {
  provider: { only: [env.OPENROUTER_PROVIDER] },
});

/** Truncate file content to avoid cost explosion on large files. */
const MAX_FILE_CHARS = 8000;
function truncateFile(content: string): string {
  if (content.length <= MAX_FILE_CHARS) return content;
  return `${content.slice(0, MAX_FILE_CHARS)}\n... (truncated, ${content.length} chars total)`;
}

const CONTEXT_PROMPT = `<document>
{FILE_CONTENT}
</document>

Here is a chunk from this {LANGUAGE} file ({FILE_PATH}):
<chunk>
{CHUNK_CONTENT}
</chunk>

Give a short context (2-3 sentences) to situate this chunk within the file.
Include: what this code does, what it depends on, and what calls or uses it.
Answer ONLY with the context, no preamble.`;

/** Generate a contextual description for a single chunk. */
export async function contextualizeChunk(
  fullFileContent: string,
  chunkContent: string,
  filePath: string,
  language: string,
): Promise<string> {
  const prompt = CONTEXT_PROMPT.replace("{FILE_CONTENT}", truncateFile(fullFileContent))
    .replace("{LANGUAGE}", language)
    .replace("{FILE_PATH}", filePath)
    .replace("{CHUNK_CONTENT}", chunkContent);

  try {
    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: 150,
      temperature: 0,
    });
    return text.trim();
  } catch (err) {
    logger.warn({ err, filePath }, "Contextualization failed, using empty context");
    return "";
  }
}

/**
 * Generate contextual descriptions for all chunks from the same file.
 * Processes sequentially to avoid rate limiting (chunks share file context).
 */
export async function contextualizeChunks(
  fullFileContent: string,
  chunks: Array<{ content: string }>,
  filePath: string,
  language: string,
): Promise<string[]> {
  const contexts: string[] = [];

  for (const chunk of chunks) {
    const ctx = await contextualizeChunk(fullFileContent, chunk.content, filePath, language);
    contexts.push(ctx);
  }

  return contexts;
}
