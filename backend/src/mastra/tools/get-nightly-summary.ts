// tools/get-nightly-summary.ts — Consolidated morning briefing from nightly intelligence.
// Returns a concise summary of recent merges, convention warnings, and untested code.

import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";

import { logger } from "../../config/logger.js";
import { qdrant } from "../infra.js";
import { truncate } from "./truncate.js";

interface ReviewResult {
  score?: number;
  metadata?: Record<string, unknown>;
}

function countBySeverity(results: ReviewResult[]) {
  const counts = { info: 0, warning: 0, critical: 0 };
  for (const r of results) {
    const sev = (r.metadata?.severity as string) ?? "info";
    if (sev in counts) counts[sev as keyof typeof counts]++;
  }
  return counts;
}

function filterRecent(results: ReviewResult[], cutoffStr: string) {
  return results.filter((r) => {
    const date = (r.metadata?.date as string) ?? "";
    return date >= cutoffStr;
  });
}

function extractIssues(recentReviews: ReviewResult[]) {
  const warningFiles = new Set<string>();
  const criticalItems: Array<{ filePath: string; summary: string; category: string }> = [];
  for (const r of recentReviews) {
    const sev = (r.metadata?.severity as string) ?? "info";
    const filePath = (r.metadata?.filePath as string) ?? "unknown";
    if (sev === "warning" || sev === "critical") warningFiles.add(filePath);
    if (sev === "critical") {
      criticalItems.push({
        filePath,
        summary: truncate((r.metadata?.text as string) ?? "", 150),
        category: (r.metadata?.category as string) ?? "unknown",
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

export const getNightlySummary = createTool({
  id: "getNightlySummary",
  mcp: {
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
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

  execute: async (inputData) => {
    const { daysBack } = inputData;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    try {
      const zeroVec = new Array(768).fill(0);
      const [reviews, testSuggestions] = await Promise.all([
        qdrant.query({ indexName: "reviews", queryVector: zeroVec, topK: 50 }).catch(() => []),
        qdrant
          .query({ indexName: "test-suggestions", queryVector: zeroVec, topK: 20 })
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
        targetFile: (r.metadata?.targetFile as string) ?? "unknown",
        testType: (r.metadata?.testType as string) ?? "unit",
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
  },
});
