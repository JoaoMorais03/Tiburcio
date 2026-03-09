// tools/git-fallback.ts — Git-based fallback data for when Qdrant collections are empty.
// Used by nightly-dependent tools (getNightlySummary, getChangeSummary, searchReviews,
// getTestSuggestions) to return useful data on first boot before the nightly pipeline runs.

import { getRepoConfigs } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { getRecentCommits } from "../../indexer/git-diff.js";
import { rawQdrant } from "../infra.js";

/** Check if a Qdrant collection exists and has at least one point. */
export async function isCollectionPopulated(collection: string): Promise<boolean> {
  try {
    const { points } = await rawQdrant.scroll(collection, { limit: 1 });
    return points.length > 0;
  } catch {
    return false;
  }
}

export interface GitCommitSummary {
  sha: string;
  author: string;
  date: string;
  message: string;
  filesChanged: number;
}

/** Get recent commits across all configured repos. */
export async function getGitCommitSummaries(sinceHours = 24): Promise<GitCommitSummary[]> {
  const repos = getRepoConfigs();
  if (repos.length === 0) return [];

  const all: GitCommitSummary[] = [];

  for (const repo of repos) {
    try {
      const commits = await getRecentCommits(repo.path, repo.branch, sinceHours);
      for (const c of commits) {
        all.push({
          sha: c.sha.slice(0, 8),
          author: c.author,
          date: c.date,
          message: c.message,
          filesChanged: c.files.length,
        });
      }
    } catch (err) {
      logger.warn({ repo: repo.name, err }, "Git fallback: failed to read commits");
    }
  }

  // Sort by date descending
  all.sort((a, b) => (b.date > a.date ? 1 : -1));
  return all;
}

/** Get recently changed files that look like test files. */
export async function getRecentTestFiles(sinceHours = 24): Promise<string[]> {
  const repos = getRepoConfigs();
  if (repos.length === 0) return [];

  const testFiles: string[] = [];
  const testPattern = /(?:test|spec|__tests__)/i;

  for (const repo of repos) {
    try {
      const commits = await getRecentCommits(repo.path, repo.branch, sinceHours);
      for (const c of commits) {
        for (const f of c.files) {
          if (testPattern.test(f) && !testFiles.includes(f)) {
            testFiles.push(f);
          }
        }
      }
    } catch {
      // skip repos that fail
    }
  }

  return testFiles.slice(0, 20);
}

/** Convert a relative time string (1d, 7d, 2w, 1m) to hours. */
export function sinceToHours(since: string): number {
  const match = since.match(/^(\d+)([dwm])$/);
  if (!match) return 24;
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "d") return amount * 24;
  if (unit === "w") return amount * 24 * 7;
  if (unit === "m") return amount * 24 * 30;
  return 24;
}

export const FALLBACK_NOTICE =
  "This data comes from git history (not AI-reviewed intelligence). " +
  "Run the nightly pipeline for richer insights: POST /api/admin/nightly-review";
