// mastra/workflows/nightly-review.ts — Nightly pipeline: re-index, review merges, generate test suggestions.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod/v4";

import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { redis } from "../../config/redis.js";
import { chunkFile, detectLanguage } from "../../indexer/chunker.js";
import { embedTexts, toUUID } from "../../indexer/embed.js";
import {
  getChangedFiles,
  getDeletedFiles,
  getFileDiffs,
  getHeadSha,
  getMergeCommits,
  getRecentCommits,
} from "../../indexer/git-diff.js";
import type { ReviewNote } from "../../indexer/index-reviews.js";
import { indexReviewNotes } from "../../indexer/index-reviews.js";
import { redactSecrets } from "../../indexer/redact.js";
import { codeReviewAgent } from "../agents/code-review-agent.js";
import { ensureCollection, qdrant } from "../infra.js";

const REDIS_KEY_LAST_SHA = "tiburcio:last-indexed-sha";
const COLLECTION = "code-chunks";
const TEST_SUGGESTIONS_COLLECTION = "test-suggestions";

// --- Step 1: Incremental re-index ---

const incrementalReindexStep = createStep({
  id: "incremental-reindex",
  description: "Re-index only files changed since the last run",
  inputSchema: z.object({}),
  outputSchema: z.object({
    filesIndexed: z.number(),
    chunksIndexed: z.number(),
  }),
  execute: async () => {
    const codebasePath = env.CODEBASE_PATH;
    if (!codebasePath) {
      logger.warn("CODEBASE_PATH not set, skipping incremental reindex");
      return { filesIndexed: 0, chunksIndexed: 0 };
    }

    const lastSha = await redis.get(REDIS_KEY_LAST_SHA);
    const changedFiles = await getChangedFiles(codebasePath, lastSha ?? undefined);

    if (changedFiles.length === 0) {
      logger.info("No files changed since last index");
      const currentSha = await getHeadSha(codebasePath);
      await redis.set(REDIS_KEY_LAST_SHA, currentSha);
      return { filesIndexed: 0, chunksIndexed: 0 };
    }

    logger.info({ count: changedFiles.length }, "Files changed since last index");

    await ensureCollection(COLLECTION);

    // Delete all vectors for files that were removed from the repo
    const deletedFiles = await getDeletedFiles(codebasePath, lastSha ?? undefined);
    if (deletedFiles.length > 0) {
      logger.info({ count: deletedFiles.length }, "Cleaning up vectors for deleted files");
      for (const relPath of deletedFiles) {
        try {
          await qdrant.deleteVectors({
            indexName: COLLECTION,
            filter: { filePath: relPath },
          });
        } catch {
          /* Collection may not exist or file had no vectors */
        }
      }
    }

    // Delete all vectors for each modified file before re-upserting to prevent orphan line-level vectors.
    let totalChunks = 0;

    for (const relPath of changedFiles) {
      const fullPath = join(codebasePath, relPath);
      try {
        // Purge stale line-level vectors before re-upserting (prevents orphans from deleted functions)
        try {
          await qdrant.deleteVectors({
            indexName: COLLECTION,
            filter: { filePath: relPath },
          });
        } catch {
          /* safe to ignore */
        }

        const content = await readFile(fullPath, "utf-8");
        const chunks = chunkFile(content, relPath);
        if (chunks.length === 0) continue;

        const textsToEmbed = chunks.map(
          (c) => `${c.language} ${c.layer} ${c.filePath}\n\n${c.content}`,
        );
        const embeddings = await embedTexts(textsToEmbed);

        await qdrant.upsert({
          indexName: COLLECTION,
          vectors: embeddings,
          ids: chunks.map((c) => toUUID(`${COLLECTION}:${c.filePath}:${c.startLine}`)),
          metadata: chunks.map((c) => ({
            text: c.content,
            filePath: c.filePath,
            language: c.language,
            layer: c.layer,
            startLine: c.startLine,
            endLine: c.endLine,
          })),
        });

        totalChunks += chunks.length;
      } catch {
        // File was deleted or unreadable — vectors already cleaned up above
      }
    }

    const currentSha = await getHeadSha(codebasePath);
    await redis.set(REDIS_KEY_LAST_SHA, currentSha);

    logger.info(
      { filesIndexed: changedFiles.length, chunksIndexed: totalChunks },
      "Incremental reindex complete",
    );
    return { filesIndexed: changedFiles.length, chunksIndexed: totalChunks };
  },
});

// --- Step 2: Code review ---

const codeReviewStep = createStep({
  id: "code-review",
  description: "Review yesterday's merges against team standards",
  inputSchema: z.object({
    filesIndexed: z.number(),
    chunksIndexed: z.number(),
  }),
  outputSchema: z.object({
    reviewNotes: z.number(),
    commits: z.number(),
    commitsJson: z.string(),
  }),
  execute: async () => {
    const codebasePath = env.CODEBASE_PATH;
    const branch = env.CODEBASE_BRANCH ?? "develop";

    if (!codebasePath) {
      logger.warn("CODEBASE_PATH not set, skipping code review");
      return { reviewNotes: 0, commits: 0, commitsJson: "[]" };
    }

    // Try merge commits first, fall back to all commits
    let commits = await getMergeCommits(codebasePath, branch);
    if (commits.length === 0) {
      commits = await getRecentCommits(codebasePath, branch);
    }

    if (commits.length === 0) {
      logger.info("No recent commits to review");
      return { reviewNotes: 0, commits: 0, commitsJson: "[]" };
    }

    logger.info({ commits: commits.length }, "Reviewing recent commits");

    const allNotes: ReviewNote[] = [];

    for (const commit of commits) {
      const fileDiffs = await getFileDiffs(codebasePath, commit.sha, commit.files);
      if (fileDiffs.length === 0) continue;

      const diffSummary = fileDiffs
        .map((d) => `--- ${d.filePath} ---\n${redactSecrets(d.diff)}`)
        .join("\n\n");

      const prompt = `Review this merge commit:
Author: ${commit.author}
Date: ${commit.date}
Message: ${commit.message}
Files changed: ${commit.files.join(", ")}

Diffs:
${diffSummary}`;

      try {
        const response = await codeReviewAgent.generate([{ role: "user", content: prompt }]);
        const text = typeof response.text === "string" ? response.text : "";

        // Parse the JSON array from the agent response
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) continue;

        const notes = JSON.parse(jsonMatch[0]) as Array<{
          severity: string;
          category: string;
          filePath: string;
          text: string;
        }>;

        for (const note of notes) {
          allNotes.push({
            text: note.text,
            severity: note.severity as ReviewNote["severity"],
            category: note.category as ReviewNote["category"],
            filePath: note.filePath,
            commitSha: commit.sha,
            author: commit.author,
            date: commit.date,
            mergeMessage: commit.message,
          });
        }
      } catch (err) {
        logger.error({ commit: commit.sha, err }, "Failed to review commit");
      }
    }

    if (allNotes.length > 0) {
      await indexReviewNotes(allNotes);
    }

    logger.info({ reviewNotes: allNotes.length, commits: commits.length }, "Code review complete");
    return {
      reviewNotes: allNotes.length,
      commits: commits.length,
      commitsJson: JSON.stringify(commits),
    };
  },
});

// --- Step 3: Test suggestions ---

const testSuggestionsStep = createStep({
  id: "test-suggestions",
  description: "Generate test scaffolds for recently changed code",
  inputSchema: z.object({
    reviewNotes: z.number(),
    commits: z.number(),
    commitsJson: z.string(),
  }),
  outputSchema: z.object({ suggestions: z.number() }),
  execute: async (ctx: {
    inputData?: { reviewNotes: number; commits: number; commitsJson: string };
    reviewNotes: number;
    commits: number;
    commitsJson: string;
  }) => {
    const codebasePath = env.CODEBASE_PATH;

    if (!codebasePath) {
      logger.warn("CODEBASE_PATH not set, skipping test suggestions");
      return { suggestions: 0 };
    }

    const input = ctx.inputData ?? ctx;
    const commits = JSON.parse(input.commitsJson) as Awaited<ReturnType<typeof getMergeCommits>>;

    if (commits.length === 0) return { suggestions: 0 };

    await ensureCollection(TEST_SUGGESTIONS_COLLECTION);

    const allSuggestions: Array<{
      text: string;
      targetFile: string;
      language: string;
      commitSha: string;
      date: string;
    }> = [];

    for (const commit of commits) {
      for (const filePath of commit.files) {
        const lang = detectLanguage(filePath);
        if (!lang) continue;

        const fileDiffs = await getFileDiffs(codebasePath, commit.sha, [filePath]);
        if (fileDiffs.length === 0) continue;

        const redactedDiff = redactSecrets(fileDiffs[0].diff);

        const prompt = `Generate a concise test suggestion for this change.

File: ${filePath} (${lang})
Commit message: ${commit.message}

Diff:
${redactedDiff}

Respond with ONLY a test scaffold — the actual test code a developer would use as a starting point. Use the testing framework appropriate for the language (Vitest for TypeScript, JUnit for Java). Keep it focused and practical.`;

        try {
          const response = await codeReviewAgent.generate([{ role: "user", content: prompt }]);
          const text = typeof response.text === "string" ? response.text : "";

          if (text.trim()) {
            allSuggestions.push({
              text,
              targetFile: filePath,
              language: lang,
              commitSha: commit.sha,
              date: commit.date,
            });
          }
        } catch (err) {
          logger.error({ file: filePath, err }, "Failed to generate test suggestion");
        }
      }
    }

    if (allSuggestions.length > 0) {
      const embeddings = await embedTexts(
        allSuggestions.map((s) => `${s.language} test ${s.targetFile}\n\n${s.text}`),
      );

      await qdrant.upsert({
        indexName: TEST_SUGGESTIONS_COLLECTION,
        vectors: embeddings,
        ids: allSuggestions.map((s, i) =>
          toUUID(`${TEST_SUGGESTIONS_COLLECTION}:${s.commitSha}:${s.targetFile}:${i}`),
        ),
        metadata: allSuggestions.map((s) => ({
          text: s.text,
          targetFile: s.targetFile,
          language: s.language,
          testType: "unit",
          commitSha: s.commitSha,
          date: s.date,
        })),
      });
    }

    logger.info({ suggestions: allSuggestions.length }, "Test suggestions complete");
    return { suggestions: allSuggestions.length };
  },
});

// --- Workflow ---

export const nightlyReviewWorkflow = createWorkflow({
  id: "nightly-review-workflow",
  inputSchema: z.object({}),
  outputSchema: z.object({ suggestions: z.number() }),
})
  .then(incrementalReindexStep)
  .then(codeReviewStep)
  .then(testSuggestionsStep)
  .commit();
