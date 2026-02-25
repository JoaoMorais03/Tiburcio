// indexer/query-expand.ts — Query expansion for better recall.
// Before searching, generate 2-3 semantic variants of the query using the LLM.
// This catches results that use different terminology for the same concept.

import { generateText } from "ai";

import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { openrouter } from "../mastra/infra.js";

const model = openrouter.chat(env.OPENROUTER_MODEL, {
  provider: { only: [env.OPENROUTER_PROVIDER] },
});

const EXPAND_PROMPT = `Given this code search query, generate 2-3 alternative phrasings that would match different code implementations of the same concept.
Focus on different terminology, class names, method names, and technical terms developers might use.

Query: "{QUERY}"

Return ONLY a JSON array of strings, no explanation. Example: ["variant 1", "variant 2", "variant 3"]`;

/**
 * Expand a user query into 2-3 semantic variants for broader recall.
 * Returns the original query plus the variants.
 */
export async function expandQuery(query: string): Promise<string[]> {
  try {
    const { text } = await generateText({
      model,
      prompt: EXPAND_PROMPT.replace("{QUERY}", query),
      maxOutputTokens: 200,
      temperature: 0.3,
    });

    // Parse JSON array — try full response, then extract from code fences
    let variants: string[];
    try {
      variants = JSON.parse(text.trim());
    } catch {
      const match = text.match(/\[[\s\S]*?\]/);
      if (!match) return [query];
      variants = JSON.parse(match[0]);
    }

    if (!Array.isArray(variants) || variants.length === 0) return [query];

    // Return original + variants (deduplicated)
    const all = [query, ...variants.filter((v): v is string => typeof v === "string")];
    return [...new Set(all)];
  } catch (err) {
    logger.warn({ err }, "Query expansion failed, using original query");
    return [query];
  }
}
