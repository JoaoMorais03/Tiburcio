// tools/get-change-summary.ts — "What did I miss?" tool.
// Queries recent reviews and groups by area, severity, and author.

import { tool } from "ai";
import { z } from "zod";

import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { rawQdrant } from "../infra.js";
import { truncate } from "./truncate.js";

const COLLECTION = "reviews";

interface SearchResult {
  score?: number;
  payload?: Record<string, unknown> | null;
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

function groupByArea(reviews: SearchResult[]) {
  const groups: Record<string, SearchResult[]> = {};
  for (const r of reviews) {
    const filePath = (r.payload?.filePath as string) ?? "unknown";
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
  reviews: SearchResult[],
  groups: Record<string, SearchResult[]>,
) {
  const severity = { info: 0, warning: 0, critical: 0 };
  const authors = new Set<string>();

  for (const r of reviews) {
    const sev = (r.payload?.severity as string) ?? "info";
    if (sev in severity) severity[sev as keyof typeof severity]++;
    const author = (r.payload?.author as string) ?? "";
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

export async function executeGetChangeSummary(since = "1d", area?: string) {
  const sinceDate = parseSince(since);

  try {
    const dims = env.EMBEDDING_DIMENSIONS as number;
    const zeroVec = new Array(dims).fill(0);
    const allResults = await rawQdrant.search(COLLECTION, {
      vector: zeroVec,
      limit: 50,
      with_payload: true,
    });
    const results = allResults.filter((r) => {
      const date = (r.payload?.date as string) ?? "";
      if (date < sinceDate) return false;
      if (area) {
        const filePath = (r.payload?.filePath as string) ?? "";
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
        severity: (r.payload?.severity as string) ?? "info",
        category: (r.payload?.category as string) ?? "unknown",
        filePath: (r.payload?.filePath as string) ?? "unknown",
        text: truncate((r.payload?.text as string) ?? "", 150),
        author: (r.payload?.author as string) ?? "unknown",
        date: (r.payload?.date as string) ?? "",
      })),
    };
  } catch (err) {
    logger.error({ err }, "getChangeSummary failed");
    return {
      summary: "Unable to generate change summary. The nightly pipeline may not have run yet.",
      changes: [],
    };
  }
}

export const getChangeSummaryTool = tool({
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
  execute: ({ since, area }) => executeGetChangeSummary(since, area),
});
