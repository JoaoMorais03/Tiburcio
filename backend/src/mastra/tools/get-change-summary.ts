// tools/get-change-summary.ts — "What did I miss?" tool.
// Queries recent reviews and groups by area, severity, and author.

import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";

import { logger } from "../../config/logger.js";
import { qdrant } from "../infra.js";
import { truncate } from "./truncate.js";

const COLLECTION = "reviews";

interface ReviewResult {
  score?: number;
  metadata?: Record<string, unknown>;
}

function parseSince(since: string): string {
  const match = since.match(/^(\d+)([dwm])$/);
  if (!match) return since; // Assume ISO date

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2];
  const now = new Date();

  if (unit === "d") now.setDate(now.getDate() - amount);
  else if (unit === "w") now.setDate(now.getDate() - amount * 7);
  else if (unit === "m") now.setMonth(now.getMonth() - amount);

  return now.toISOString().split("T")[0];
}

function groupByArea(reviews: ReviewResult[]) {
  const groups: Record<string, ReviewResult[]> = {};
  for (const r of reviews) {
    const filePath = (r.metadata?.filePath as string) ?? "unknown";
    // Extract area from file path (first directory segment)
    const parts = filePath.split("/");
    const area = parts.length > 1 ? parts[parts.length > 2 ? 1 : 0] : "root";
    if (!groups[area]) groups[area] = [];
    groups[area].push(r);
  }
  return groups;
}

function buildSummary(
  sinceDate: string,
  reviews: ReviewResult[],
  groups: Record<string, ReviewResult[]>,
) {
  const severity = { info: 0, warning: 0, critical: 0 };
  const authors = new Set<string>();

  for (const r of reviews) {
    const sev = (r.metadata?.severity as string) ?? "info";
    if (sev in severity) severity[sev as keyof typeof severity]++;
    const author = (r.metadata?.author as string) ?? "";
    if (author) authors.add(author);
  }

  const lines = [`Changes since ${sinceDate}:`];
  lines.push(`- ${reviews.length} review notes across ${Object.keys(groups).length} area(s)`);
  if (severity.critical > 0) lines.push(`- ${severity.critical} CRITICAL issues`);
  if (severity.warning > 0) lines.push(`- ${severity.warning} warnings`);
  if (authors.size > 0) lines.push(`- Authors: ${[...authors].join(", ")}`);
  lines.push("");
  lines.push("By area:");
  for (const [area, items] of Object.entries(groups)) {
    lines.push(`  ${area}: ${items.length} note(s)`);
  }
  return lines.join("\n");
}

export const getChangeSummary = createTool({
  id: "getChangeSummary",
  mcp: {
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  description:
    "Get a summary of what changed in the codebase over a time period. " +
    "Use when a developer asks 'what did I miss?', 'what changed this week?', " +
    "or is returning from vacation. Groups changes by area and severity. " +
    "For detailed review notes, use searchReviews. For test scaffolds, use getTestSuggestions.",
  inputSchema: z.object({
    since: z
      .string()
      .default("1d")
      .describe("How far back: '1d', '3d', '7d', '2w', '1m', or ISO date like '2026-02-25'"),
    area: z
      .string()
      .optional()
      .describe("Focus on a specific code area, e.g. 'auth', 'services', 'frontend'"),
  }),

  execute: async (inputData) => {
    const { since, area } = inputData;
    const sinceDate = parseSince(since);

    try {
      // Use a zero vector to fetch recent results, then filter by date in code.
      // The Mastra wrapper's filter type doesn't support Qdrant range conditions,
      // so we over-fetch and filter client-side (same pattern as getNightlySummary).
      const zeroVec = new Array(768).fill(0);
      const allResults = await qdrant.query({
        indexName: COLLECTION,
        queryVector: zeroVec,
        topK: 50,
      });
      const results = allResults.filter((r) => {
        const date = (r.metadata?.date as string) ?? "";
        if (date < sinceDate) return false;
        if (area) {
          const filePath = (r.metadata?.filePath as string) ?? "";
          return filePath.includes(area);
        }
        return true;
      });

      if (results.length === 0) {
        return {
          summary:
            `No review data found since ${sinceDate}. ` +
            "The nightly pipeline may not have run yet, or there were no merges in this period.",
          changes: [],
        };
      }

      const groups = groupByArea(results);
      const summary = buildSummary(sinceDate, results, groups);

      return {
        summary,
        changes: results.slice(0, 10).map((r) => ({
          severity: r.metadata?.severity ?? "info",
          category: r.metadata?.category ?? "unknown",
          filePath: r.metadata?.filePath ?? "unknown",
          text: truncate((r.metadata?.text as string) ?? "", 150),
          author: r.metadata?.author ?? "unknown",
          date: r.metadata?.date ?? "",
        })),
      };
    } catch (err) {
      logger.error({ err }, "getChangeSummary failed");
      return {
        summary: "Unable to generate change summary. The nightly pipeline may not have run yet.",
        changes: [],
      };
    }
  },
});
