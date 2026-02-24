// indexer/git-diff.ts — Git diff utilities for the nightly pipeline.
// Reads merge commits and changed files from the target codebase repository.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const MAX_DIFF_SIZE = 50_000; // chars per file — truncate huge diffs

interface MergeCommit {
  sha: string;
  author: string;
  date: string;
  message: string;
  files: string[];
}

interface FileDiff {
  filePath: string;
  diff: string;
}

/** Get files changed since a commit SHA (or in the last 24h if no SHA). */
export async function getChangedFiles(repoPath: string, sinceSha?: string): Promise<string[]> {
  const args = sinceSha
    ? ["diff", "--name-only", sinceSha, "HEAD"]
    : ["log", "--since=24 hours ago", "--name-only", "--pretty=format:"];

  const { stdout } = await exec("git", args, { cwd: repoPath });
  const files = stdout
    .split("\n")
    .map((f: string) => f.trim())
    .filter(Boolean);
  return [...new Set(files)];
}

/** Get the current HEAD commit SHA. */
export async function getHeadSha(repoPath: string): Promise<string> {
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], {
    cwd: repoPath,
  });
  return stdout.trim();
}

/** Get merge commits to a branch in the last N hours. */
export async function getMergeCommits(
  repoPath: string,
  branch: string,
  sinceHours = 24,
): Promise<MergeCommit[]> {
  const { stdout } = await exec(
    "git",
    ["log", `--since=${sinceHours} hours ago`, "--merges", "--pretty=format:%H|%an|%aI|%s", branch],
    { cwd: repoPath },
  );

  if (!stdout.trim()) return [];

  const commits: MergeCommit[] = [];

  for (const line of stdout.trim().split("\n")) {
    const [sha, author, date, ...messageParts] = line.split("|");
    if (!sha) continue;

    const { stdout: filesOut } = await exec(
      "git",
      ["diff-tree", "--no-commit-id", "--name-only", "-r", sha],
      { cwd: repoPath },
    );

    commits.push({
      sha,
      author,
      date,
      message: messageParts.join("|"),
      files: filesOut
        .split("\n")
        .map((f: string) => f.trim())
        .filter(Boolean),
    });
  }

  return commits;
}

/** Get the diff content for specific files from a merge commit. */
export async function getFileDiffs(
  repoPath: string,
  commitSha: string,
  files: string[],
): Promise<FileDiff[]> {
  const diffs: FileDiff[] = [];

  for (const filePath of files) {
    try {
      const { stdout } = await exec(
        "git",
        ["diff", `${commitSha}^..${commitSha}`, "--", filePath],
        { cwd: repoPath, maxBuffer: 1024 * 1024 },
      );

      const diff =
        stdout.length > MAX_DIFF_SIZE
          ? `${stdout.slice(0, MAX_DIFF_SIZE)}\n... (truncated)`
          : stdout;

      if (diff.trim()) diffs.push({ filePath, diff });
    } catch {
      // skip files that can't be diffed (binary, deleted, etc.)
    }
  }

  return diffs;
}

/** Get files deleted since a commit SHA (or in the last 24h if no SHA). */
export async function getDeletedFiles(repoPath: string, sinceSha?: string): Promise<string[]> {
  const args = sinceSha
    ? ["diff", "--name-only", "--diff-filter=D", sinceSha, "HEAD"]
    : ["log", "--since=24 hours ago", "--diff-filter=D", "--name-only", "--pretty=format:"];
  const { stdout } = await exec("git", args, { cwd: repoPath });
  return [
    ...new Set(
      stdout
        .split("\n")
        .map((f: string) => f.trim())
        .filter(Boolean),
    ),
  ];
}

/** Get all recent commits (not just merges) with their diffs. Falls back when there are no merge commits. */
export async function getRecentCommits(
  repoPath: string,
  branch: string,
  sinceHours = 24,
): Promise<MergeCommit[]> {
  const { stdout } = await exec(
    "git",
    ["log", `--since=${sinceHours} hours ago`, "--pretty=format:%H|%an|%aI|%s", branch],
    { cwd: repoPath },
  );

  if (!stdout.trim()) return [];

  const commits: MergeCommit[] = [];

  for (const line of stdout.trim().split("\n")) {
    const [sha, author, date, ...messageParts] = line.split("|");
    if (!sha) continue;

    const { stdout: filesOut } = await exec(
      "git",
      ["diff-tree", "--no-commit-id", "--name-only", "-r", sha],
      { cwd: repoPath },
    );

    commits.push({
      sha,
      author,
      date,
      message: messageParts.join("|"),
      files: filesOut
        .split("\n")
        .map((f: string) => f.trim())
        .filter(Boolean),
    });
  }

  return commits;
}
