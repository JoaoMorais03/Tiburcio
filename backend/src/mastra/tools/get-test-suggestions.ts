// tools/get-test-suggestions.ts — Search AI-generated test suggestions via Qdrant.

import { tool } from "ai";
import { z } from "zod";

import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { embedText } from "../../indexer/embed.js";
import { rawQdrant } from "../infra.js";
import { FALLBACK_NOTICE, getRecentTestFiles } from "./git-fallback.js";
import { truncate } from "./truncate.js";

const COLLECTION = "test-suggestions";

export async function executeGetTestSuggestions(
  query: string,
  language?: string,
  since?: string,
  compact = true,
) {
  const textToEmbed = [language, query].filter(Boolean).join(" ");
  const embedding = await embedText(textToEmbed);

  const conditions: Array<Record<string, unknown>> = [];
  if (language) conditions.push({ key: "language", match: { value: language } });
  if (since) conditions.push({ key: "date", range: { gte: since } });

  const filter = conditions.length > 0 ? { must: conditions } : undefined;

  try {
    const results = await rawQdrant.search(COLLECTION, {
      vector: embedding,
      limit: compact ? 3 : 5,
      filter,
      with_payload: true,
    });

    if (results.length === 0) {
      return {
        results: [],
        message:
          "No test suggestions found. The nightly pipeline may not have run yet. " +
          (language ? "Try removing the language filter. " : "") +
          "Try searchReviews for recent changes, or searchCode for existing test files.",
      };
    }

    const threshold = env.RETRIEVAL_CONFIDENCE_THRESHOLD as number;
    const topScore = results[0]?.score ?? 0;
    if (topScore < threshold) {
      logger.info({ topScore, threshold }, "Results below confidence threshold");
      return {
        results: [],
        message: `No high-confidence results found (best score: ${topScore.toFixed(3)}, threshold: ${threshold}). Try rephrasing the query or using a different tool.`,
      };
    }

    return {
      results: results.map((r) => ({
        suggestion: compact
          ? truncate((r.payload?.text as string) ?? "", 200)
          : truncate((r.payload?.text as string) ?? "", 2000),
        targetFile: (r.payload?.targetFile as string) ?? "unknown",
        testType: (r.payload?.testType as string) ?? "unit",
        language: (r.payload?.language as string) ?? "unknown",
        ...(compact ? {} : { commitSha: (r.payload?.commitSha as string) ?? "" }),
        date: (r.payload?.date as string) ?? "",
        score: r.score ?? 0,
      })),
    };
  } catch (err) {
    logger.error({ err, collection: COLLECTION }, "Tool query failed");
    // Fall back to listing recently changed test files from git
    const testFiles = await getRecentTestFiles(72).catch(() => [] as string[]);
    if (testFiles.length > 0) {
      return {
        source: "git-log" as const,
        notice: FALLBACK_NOTICE,
        results: testFiles.map((f) => ({
          suggestion: `Recently changed test file — review for coverage gaps.`,
          targetFile: f,
          testType: "unknown" as const,
          language: f.endsWith(".ts") ? "typescript" : f.endsWith(".vue") ? "vue" : "unknown",
          date: new Date().toISOString().split("T")[0],
          score: 0,
        })),
      };
    }
    return {
      results: [],
      message:
        "Test suggestions collection not yet indexed. The nightly pipeline may not have run yet.",
    };
  }
}

export const getTestSuggestionsTool = tool({
  description:
    "Get AI-generated test suggestions for recently merged code. " +
    "Returns test scaffolds based on team conventions and existing test patterns. " +
    "Use when someone asks how to test something or wants to write tests for recent changes. " +
    "For what changed recently, use searchReviews first.",
  inputSchema: z.object({
    query: z.string().describe("What code to get test suggestions for, e.g. 'auth token refresh'"),
    language: z
      .enum(["java", "typescript", "vue"])
      .optional()
      .describe("Filter by programming language"),
    since: z
      .string()
      .optional()
      .describe("Only return suggestions from this date onward (ISO date, e.g. '2026-02-27')"),
    compact: z
      .boolean()
      .default(true)
      .describe(
        "When true (default), returns targetFile, language, and test name pointer. " +
          "When false, returns full test scaffold suggestion.",
      ),
  }),
  execute: ({ query, language, since, compact }) =>
    executeGetTestSuggestions(query, language, since, compact),
});
