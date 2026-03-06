// tools/search-reviews.ts — Search nightly code review insights via Qdrant.

import { tool } from "ai";
import { z } from "zod";

import { logger } from "../../config/logger.js";
import { embedText } from "../../indexer/embed.js";
import { rawQdrant } from "../infra.js";
import { truncate } from "./truncate.js";

const COLLECTION = "reviews";

export async function executeSearchReviews(
  query: string,
  severity?: string,
  category?: string,
  since?: string,
  compact = true,
) {
  const embedding = await embedText(query);

  const conditions: Array<Record<string, unknown>> = [];
  if (severity) conditions.push({ key: "severity", match: { value: severity } });
  if (category) conditions.push({ key: "category", match: { value: category } });
  if (since) conditions.push({ key: "date", range: { gte: since } });

  const filter = conditions.length > 0 ? { must: conditions } : undefined;

  try {
    const results = await rawQdrant.search(COLLECTION, {
      vector: embedding,
      limit: compact ? 3 : 8,
      filter,
      with_payload: true,
    });

    if (results.length === 0) {
      return {
        results: [],
        message:
          "No review insights found. The nightly review may not have run yet. " +
          (severity || category ? "Try removing the severity/category filter. " : "") +
          "Try searchCode for the actual code, or getTestSuggestions for test scaffolds.",
      };
    }

    if (compact) {
      return {
        results: results.map((r) => ({
          severity: (r.payload?.severity as string) ?? "info",
          category: (r.payload?.category as string) ?? "unknown",
          filePath: (r.payload?.filePath as string) ?? "unknown",
          summary: truncate((r.payload?.text as string) ?? "", 150),
          date: (r.payload?.date as string) ?? "",
          score: r.score ?? 0,
        })),
      };
    }

    return {
      results: results.map((r) => ({
        review: truncate((r.payload?.text as string) ?? ""),
        severity: (r.payload?.severity as string) ?? "info",
        category: (r.payload?.category as string) ?? "unknown",
        filePath: (r.payload?.filePath as string) ?? "unknown",
        commitSha: (r.payload?.commitSha as string) ?? "",
        author: (r.payload?.author as string) ?? "unknown",
        date: (r.payload?.date as string) ?? "",
        mergeMessage: truncate((r.payload?.mergeMessage as string) ?? "", 300),
        score: r.score ?? 0,
      })),
    };
  } catch (err) {
    logger.error({ err, collection: COLLECTION }, "Tool query failed");
    return {
      results: [],
      message: "Reviews collection not yet indexed. The nightly review may not have run yet.",
    };
  }
}

export const searchReviewsTool = tool({
  description:
    "Search recent code review insights from automated nightly reviews. " +
    "Use this when someone asks about recent changes, known issues, " +
    "what happened in a specific area of the codebase recently, or " +
    "what to test from yesterday's merges. " +
    "For test scaffolds based on those reviews, use getTestSuggestions.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("What to search for, e.g. 'recent auth changes' or 'yesterday warnings'"),
    severity: z
      .enum(["info", "warning", "critical"])
      .optional()
      .describe("Filter by severity level"),
    category: z
      .enum(["convention", "bug", "security", "pattern", "architecture", "change-summary"])
      .optional()
      .describe("Filter by review category"),
    since: z
      .string()
      .optional()
      .describe("Only return reviews from this date onward (ISO date, e.g. '2026-02-27')"),
    compact: z
      .boolean()
      .default(true)
      .describe(
        "When true (default), returns severity, category, filePath, and 1-line summary. " +
          "When false, returns full review text with commit details.",
      ),
  }),
  execute: ({ query, severity, category, since, compact }) =>
    executeSearchReviews(query, severity, category, since, compact),
});
