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
    const { count } = await rawQdrant.count(collection);
    return count > 0;
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

  const results = await Promise.all(
    repos.map(async (repo) => {
      try {
        const commits = await getRecentCommits(repo.path, repo.branch, sinceHours);
        return commits.map((c) => ({
          sha: c.sha.slice(0, 8),
          author: c.author,
          date: c.date,
          message: c.message,
          filesChanged: c.files.length,
        }));
      } catch (err) {
        logger.warn({ repo: repo.name, err }, "Git fallback: failed to read commits");
        return [];
      }
    }),
  );
  const all = results.flat();

  // Sort by date descending
  all.sort((a, b) => (b.date > a.date ? 1 : -1));
  return all;
}

/** Get recently changed files that look like test files. */
export async function getRecentTestFiles(sinceHours = 24): Promise<string[]> {
  const repos = getRepoConfigs();
  if (repos.length === 0) return [];

  const seen = new Set<string>();
  const testPattern = /(?:test|spec|__tests__)/i;

  for (const repo of repos) {
    try {
      const commits = await getRecentCommits(repo.path, repo.branch, sinceHours);
      for (const c of commits) {
        for (const f of c.files) {
          if (testPattern.test(f)) seen.add(f);
        }
      }
    } catch {
      // skip repos that fail
    }
  }

  return [...seen].slice(0, 20);
}

/** Convert a relative time string (1d, 7d, 2w, 1m) or ISO date to hours. Capped at 90 days. */
export function sinceToHours(since: string): number {
  const match = since.match(/^(\d+)([dwm])$/);
  if (match) {
    const amount = Number.parseInt(match[1], 10);
    const unit = match[2];
    const hours = unit === "d" ? amount * 24 : unit === "w" ? amount * 24 * 7 : amount * 24 * 30;
    return Math.min(hours, 2160); // cap at 90 days
  }
  // Try ISO date
  const date = new Date(since);
  if (!Number.isNaN(date.getTime())) {
    return Math.min(Math.max(1, (Date.now() - date.getTime()) / 3_600_000), 2160);
  }
  return 24;
}

export const FALLBACK_NOTICE =
  "This data comes from git history (not AI-reviewed intelligence). " +
  "Run the nightly pipeline for richer insights: POST /api/admin/nightly-review";
