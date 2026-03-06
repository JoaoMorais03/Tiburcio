// tools/get-nightly-summary.ts — Consolidated morning briefing from nightly intelligence.
// Returns a concise summary of recent merges, convention warnings, and untested code.

import { tool } from "ai";
import { z } from "zod";

import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { rawQdrant } from "../infra.js";
import { truncate } from "./truncate.js";

interface SearchResult {
  score?: number;
  payload?: Record<string, unknown> | null;
}

function countBySeverity(results: SearchResult[]) {
  const counts = { info: 0, warning: 0, critical: 0 };
  for (const r of results) {
    const sev = (r.payload?.severity as string) ?? "info";
    if (sev in counts) counts[sev as keyof typeof counts]++;
  }
  return counts;
}

function filterRecent(results: SearchResult[], cutoffStr: string) {
  return results.filter((r) => {
    const date = (r.payload?.date as string) ?? "";
    return date >= cutoffStr;
  });
}

function extractIssues(recentReviews: SearchResult[]) {
  const warningFiles = new Set<string>();
  const criticalItems: Array<{ filePath: string; summary: string; category: string }> = [];
  for (const r of recentReviews) {
    const sev = (r.payload?.severity as string) ?? "info";
    const filePath = (r.payload?.filePath as string) ?? "unknown";
    if (sev === "warning" || sev === "critical") warningFiles.add(filePath);
    if (sev === "critical") {
      criticalItems.push({
        filePath,
        summary: truncate((r.payload?.text as string) ?? "", 150),
        category: (r.payload?.category as string) ?? "unknown",
      });
    }
  }
  return { warningFiles, criticalItems };
}

function buildBriefing(
  daysBack: number,
  reviewCount: number,
  severity: ReturnType<typeof countBySeverity>,
  warningFileCount: number,
  testGapCount: number,
) {
  const lines = [`Nightly briefing (last ${daysBack} day${daysBack > 1 ? "s" : ""}):`];
  lines.push(`- ${reviewCount} review insights found`);
  if (severity.critical > 0) lines.push(`- ${severity.critical} CRITICAL issues`);
  if (severity.warning > 0) lines.push(`- ${severity.warning} warnings`);
  if (severity.info > 0) lines.push(`- ${severity.info} informational notes`);
  if (warningFileCount > 0) lines.push(`- ${warningFileCount} file(s) with issues`);
  if (testGapCount > 0) lines.push(`- ${testGapCount} file(s) with test suggestions`);
  return lines.join("\n");
}

export async function executeGetNightlySummary(daysBack = 1) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  try {
    const dims = env.EMBEDDING_DIMENSIONS as number;
    const zeroVec = new Array(dims).fill(0);
    const [reviews, testSuggestions] = await Promise.all([
      rawQdrant
        .search("reviews", { vector: zeroVec, limit: 50, with_payload: true })
        .catch(() => []),
      rawQdrant
        .search("test-suggestions", { vector: zeroVec, limit: 20, with_payload: true })
        .catch(() => []),
    ]);

    const recentReviews = filterRecent(reviews, cutoffStr);
    const recentTests = filterRecent(testSuggestions, cutoffStr);

    if (recentReviews.length === 0 && recentTests.length === 0) {
      return {
        summary:
          `No nightly intelligence data found for the last ${daysBack} day(s). ` +
          "The nightly pipeline may not have run yet, or there were no merges to review.",
        testGaps: [],
      };
    }

    const severity = countBySeverity(recentReviews);
    const { warningFiles, criticalItems } = extractIssues(recentReviews);
    const testGaps = recentTests.map((r) => ({
      targetFile: (r.payload?.targetFile as string) ?? "unknown",
      testType: (r.payload?.testType as string) ?? "unit",
    }));

    return {
      summary: buildBriefing(
        daysBack,
        recentReviews.length,
        severity,
        warningFiles.size,
        testGaps.length,
      ),
      severityCounts: severity,
      criticalItems: criticalItems.slice(0, 5),
      warningFiles: [...warningFiles].slice(0, 10),
      testGaps: testGaps.slice(0, 5),
    };
  } catch (err) {
    logger.error({ err }, "getNightlySummary failed");
    return {
      summary: "Unable to generate nightly summary. The nightly pipeline may not have run yet.",
      testGaps: [],
    };
  }
}

export const getNightlySummaryTool = tool({
  description:
    "Get a consolidated morning briefing from the nightly intelligence pipeline. " +
    "Returns: merge count, convention warnings, untested files, and actionable items. " +
    "Use this at the start of a work session to understand what changed overnight. " +
    "For details on specific reviews, use searchReviews. For test scaffolds, use getTestSuggestions.",
  inputSchema: z.object({
    daysBack: z
      .number()
      .default(1)
      .describe("How many days back to summarize (default: 1 for yesterday)"),
  }),
  execute: ({ daysBack }) => executeGetNightlySummary(daysBack),
});
