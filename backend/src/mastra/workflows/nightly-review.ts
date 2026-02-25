// mastra/workflows/nightly-review.ts — Nightly pipeline: re-index, review merges, generate test suggestions.
// v1.1: Incremental reindex now uses contextual retrieval, header metadata, and BM25 sparse vectors.
// v1.2: Multi-repo support — iterates over all repos from CODEBASE_REPOS.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod/v4";

import { getRepoConfigs } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { redis } from "../../config/redis.js";
import { textToSparse } from "../../indexer/bm25.js";
import { chunkFile, detectLanguage } from "../../indexer/chunker.js";
import { contextualizeChunks } from "../../indexer/contextualize.js";
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
import { ensureCollection, rawQdrant } from "../infra.js";

const COLLECTION = "code-chunks";
const TEST_SUGGESTIONS_COLLECTION = "test-suggestions";

// --- Step 1: Incremental re-index ---

const incrementalReindexStep = createStep({
  id: "incremental-reindex",
  description: "Re-index only files changed since the last run (all repos)",
  inputSchema: z.object({}),
  outputSchema: z.object({
    filesIndexed: z.number(),
    chunksIndexed: z.number(),
  }),
  execute: async () => {
    const repos = getRepoConfigs();
    if (repos.length === 0) {
      logger.warn("CODEBASE_REPOS not set, skipping incremental reindex");
      return { filesIndexed: 0, chunksIndexed: 0 };
    }

    await ensureCollection(COLLECTION, 4096, true);
    try {
      await rawQdrant.createPayloadIndex(COLLECTION, {
        field_name: "repo",
        field_schema: "keyword",
        wait: true,
      });
    } catch {
      // Index already exists — fine
    }

    let totalFiles = 0;
    let totalChunks = 0;

    for (const repo of repos) {
      const redisKey = `tiburcio:codebase-head:${repo.name}`;
      const lastSha = await redis.get(redisKey);
      const changedFiles = await getChangedFiles(repo.path, lastSha ?? undefined);

      if (changedFiles.length === 0) {
        logger.info({ repo: repo.name }, "No files changed since last index");
        const currentSha = await getHeadSha(repo.path);
        await redis.set(redisKey, currentSha);
        continue;
      }

      logger.info(
        { repo: repo.name, count: changedFiles.length },
        "Files changed since last index",
      );

      // Delete all vectors for files that were removed from this repo
      const deletedFiles = await getDeletedFiles(repo.path, lastSha ?? undefined);
      if (deletedFiles.length > 0) {
        logger.info(
          { repo: repo.name, count: deletedFiles.length },
          "Cleaning up vectors for deleted files",
        );
        for (const relPath of deletedFiles) {
          try {
            await rawQdrant.delete(COLLECTION, {
              wait: true,
              filter: {
                must: [
                  { key: "repo", match: { value: repo.name } },
                  { key: "filePath", match: { value: relPath } },
                ],
              },
            });
          } catch {
            /* Collection may not exist or file had no vectors */
          }
        }
      }

      for (const relPath of changedFiles) {
        const fullPath = join(repo.path, relPath);
        try {
          // Purge stale vectors before re-upserting
          try {
            await rawQdrant.delete(COLLECTION, {
              wait: true,
              filter: {
                must: [
                  { key: "repo", match: { value: repo.name } },
                  { key: "filePath", match: { value: relPath } },
                ],
              },
            });
          } catch {
            /* safe to ignore */
          }

          const content = await readFile(fullPath, "utf-8");
          const chunks = chunkFile(content, relPath);
          if (chunks.length === 0) continue;

          // Link each chunk to its file's header chunk
          const headerChunk = chunks.find((c) => c.chunkType === "header");
          const headerChunkUUID = headerChunk
            ? toUUID(`${repo.name}:${relPath}:${headerChunk.startLine}`)
            : null;
          for (const chunk of chunks) {
            chunk.headerChunkId = chunk.chunkType === "header" ? null : headerChunkUUID;
          }

          // Generate contextual descriptions
          let contexts: string[];
          try {
            contexts = await contextualizeChunks(content, chunks, relPath, chunks[0].language);
          } catch {
            contexts = chunks.map(() => "");
          }

          // Prepend context to embedding text
          const textsToEmbed = chunks.map((c, idx) => {
            const prefix = `${c.language} ${c.layer} ${c.filePath}`;
            return contexts[idx]
              ? `${contexts[idx]}\n\n${prefix}\n\n${c.content}`
              : `${prefix}\n\n${c.content}`;
          });
          const embeddings = await embedTexts(textsToEmbed);

          // Upsert with both dense + sparse vectors
          const points = chunks.map((c, idx) => {
            const sparseText = [c.content, c.symbolName, c.parentSymbol, c.annotations.join(" ")]
              .filter(Boolean)
              .join(" ");
            return {
              id: toUUID(`${repo.name}:${c.filePath}:${c.startLine}`),
              vector: {
                dense: embeddings[idx],
                bm25: textToSparse(sparseText),
              },
              payload: {
                repo: repo.name,
                text: redactSecrets(c.content),
                context: contexts[idx],
                filePath: c.filePath,
                language: c.language,
                layer: c.layer,
                startLine: c.startLine,
                endLine: c.endLine,
                symbolName: c.symbolName,
                parentSymbol: c.parentSymbol,
                chunkType: c.chunkType,
                annotations: c.annotations,
                chunkIndex: c.chunkIndex,
                totalChunks: c.totalChunks,
                headerChunkId: c.headerChunkId,
              },
            };
          });

          await rawQdrant.upsert(COLLECTION, { wait: true, points });
          totalChunks += chunks.length;
        } catch {
          // File was deleted or unreadable — vectors already cleaned up above
        }
      }

      totalFiles += changedFiles.length;
      const currentSha = await getHeadSha(repo.path);
      await redis.set(redisKey, currentSha);
      logger.info({ repo: repo.name, files: changedFiles.length }, "Repo incremental reindex done");
    }

    logger.info(
      { filesIndexed: totalFiles, chunksIndexed: totalChunks },
      "Incremental reindex complete",
    );
    return { filesIndexed: totalFiles, chunksIndexed: totalChunks };
  },
});

// --- Step 2: Code review ---

const codeReviewStep = createStep({
  id: "code-review",
  description: "Review yesterday's merges against team standards (all repos)",
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
    const repos = getRepoConfigs();
    if (repos.length === 0) {
      logger.warn("CODEBASE_REPOS not set, skipping code review");
      return { reviewNotes: 0, commits: 0, commitsJson: "[]" };
    }

    const allNotes: ReviewNote[] = [];
    const allCommits: Awaited<ReturnType<typeof getMergeCommits>> = [];

    for (const repo of repos) {
      // Try merge commits first, fall back to all commits
      let commits = await getMergeCommits(repo.path, repo.branch);
      if (commits.length === 0) {
        commits = await getRecentCommits(repo.path, repo.branch);
      }
      if (commits.length === 0) continue;

      logger.info({ repo: repo.name, commits: commits.length }, "Reviewing recent commits");
      allCommits.push(...commits);

      for (const commit of commits) {
        const fileDiffs = await getFileDiffs(repo.path, commit.sha, commit.files);
        if (fileDiffs.length === 0) continue;

        const diffSummary = fileDiffs
          .map((d) => `--- ${d.filePath} ---\n${redactSecrets(d.diff)}`)
          .join("\n\n");

        const prompt = `Review this merge commit:
Repo: ${repo.name}
Author: ${commit.author}
Date: ${commit.date}
Message: ${commit.message}
Files changed: ${commit.files.join(", ")}

Diffs:
${diffSummary}`;

        try {
          const response = await codeReviewAgent.generate([{ role: "user", content: prompt }]);
          const text = typeof response.text === "string" ? response.text : "";

          // Parse JSON array: try full response first, then code fences, then bare regex
          let notes: Array<{
            severity: string;
            category: string;
            filePath: string;
            text: string;
          }>;
          try {
            notes = JSON.parse(text);
          } catch {
            const fenceMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
            const bareMatch = text.match(/\[[\s\S]*\]/);
            const raw = fenceMatch?.[1] ?? bareMatch?.[0];
            if (!raw) continue;
            try {
              notes = JSON.parse(raw);
            } catch {
              logger.warn({ commit: commit.sha }, "Failed to parse review JSON");
              continue;
            }
          }

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
    }

    if (allNotes.length > 0) {
      await indexReviewNotes(allNotes);
    }

    logger.info(
      { reviewNotes: allNotes.length, commits: allCommits.length },
      "Code review complete",
    );
    return {
      reviewNotes: allNotes.length,
      commits: allCommits.length,
      commitsJson: JSON.stringify(allCommits),
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
    const repos = getRepoConfigs();
    if (repos.length === 0) {
      logger.warn("CODEBASE_REPOS not set, skipping test suggestions");
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

    // Build a map of repo paths to try when looking up file diffs
    const repoPaths = repos.map((r) => r.path);

    for (const commit of commits) {
      for (const filePath of commit.files) {
        const lang = detectLanguage(filePath);
        if (!lang) continue;

        // Try each repo path to find the commit's diffs
        let fileDiffs: Awaited<ReturnType<typeof getFileDiffs>> = [];
        for (const repoPath of repoPaths) {
          try {
            fileDiffs = await getFileDiffs(repoPath, commit.sha, [filePath]);
            if (fileDiffs.length > 0) break;
          } catch {}
        }
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

      await rawQdrant.upsert(TEST_SUGGESTIONS_COLLECTION, {
        wait: true,
        points: allSuggestions.map((s, i) => ({
          id: toUUID(`${TEST_SUGGESTIONS_COLLECTION}:${s.commitSha}:${s.targetFile}:${i}`),
          vector: embeddings[i],
          payload: {
            text: s.text,
            targetFile: s.targetFile,
            language: s.language,
            testType: "unit",
            commitSha: s.commitSha,
            date: s.date,
          },
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
