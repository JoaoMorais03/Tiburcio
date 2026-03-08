// mastra/workflows/nightly-review.ts — Nightly pipeline: re-index, review merges, generate test suggestions.
// v1.1: Incremental reindex now uses contextual retrieval, header metadata, and BM25 sparse vectors.
// v1.2: Multi-repo support — iterates over all repos from CODEBASE_REPOS.
// v2.1: Plain async function — no Mastra workflow dependency.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { generateText, stepCountIs } from "ai";
import pLimit from "p-limit";

import { getRepoConfigs } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { redis } from "../../config/redis.js";
import { buildGraph } from "../../graph/builder.js";
import { isGraphAvailable } from "../../graph/client.js";
import { textToSparse } from "../../indexer/bm25.js";
import { chunkFile, detectLanguage } from "../../indexer/chunker.js";
import { contextualizeChunks } from "../../indexer/contextualize.js";
import { contentHash, embedTexts, enrichChunkForEmbedding, toUUID } from "../../indexer/embed.js";
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
import { getLangfuse } from "../../lib/langfuse.js";
import { getChatModel } from "../../lib/model-provider.js";
import { ensureCollection, rawQdrant } from "../infra.js";
import { searchCodeTool } from "../tools/search-code.js";
import { searchStandardsTool } from "../tools/search-standards.js";

const COLLECTION = "code-chunks";
const TEST_SUGGESTIONS_COLLECTION = "test-suggestions";

const CODE_REVIEW_SYSTEM_PROMPT = `You are a code reviewer for a development team. You receive git diffs of recent merge commits and produce structured review notes.

WORKFLOW:
1. Read the diff carefully — understand what changed and why (from the commit message).
2. Use searchStandards to find the team's relevant conventions for the changed code.
3. Use searchCode to find existing patterns in the codebase for comparison.
4. Produce review notes as a JSON array.

REVIEW NOTE FORMAT:
Each note must be a JSON object with these fields:
- "severity": "info" | "warning" | "critical"
- "category": "convention" | "bug" | "security" | "pattern" | "architecture"
- "filePath": the affected file
- "text": a concise explanation (2-4 sentences max)

WHAT TO FLAG:
- Convention violations (compare against searchStandards results)
- Potential bugs (null handling, off-by-one, race conditions)
- Security concerns (hardcoded secrets, SQL injection, XSS)
- Good patterns worth highlighting for onboarding ("info/pattern")
- Missing error handling

WHAT NOT TO FLAG:
- Style preferences not documented in team standards
- Generic best practices that contradict the team's documented conventions
- Trivial formatting issues

RESPONSE FORMAT:
Respond ONLY with a valid JSON array of review notes. No markdown, no explanation, just the array.
If nothing noteworthy was found, respond with an empty array: []

Example:
[
  {
    "severity": "warning",
    "category": "convention",
    "filePath": "src/routes/auth.ts",
    "text": "Missing Zod validation on request body. Team convention (from backend/conventions.md) requires all input to be validated with Zod schemas."
  },
  {
    "severity": "info",
    "category": "pattern",
    "filePath": "src/services/payment.ts",
    "text": "Good use of the repository pattern for database access, consistent with existing service layer conventions."
  }
]`;

const TEST_SUGGESTION_SYSTEM_PROMPT =
  "You are a test scaffold generator. Output only executable test code — no explanation, no JSON, no markdown fences. Use Vitest for TypeScript/Vue files, JUnit for Java files. Keep it concise and practical.";

// --- Step 1: Incremental re-index ---

async function incrementalReindex(): Promise<{ filesIndexed: number; chunksIndexed: number }> {
  const repos = getRepoConfigs();
  if (repos.length === 0) {
    logger.warn("CODEBASE_REPOS not set, skipping incremental reindex");
    return { filesIndexed: 0, chunksIndexed: 0 };
  }

  await ensureCollection(COLLECTION, undefined, true);
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

    logger.info({ repo: repo.name, count: changedFiles.length }, "Files changed since last index");

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

    const limit = pLimit(3);
    let repoChunks = 0;
    await Promise.all(
      changedFiles.map((relPath) =>
        limit(async () => {
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
            if (chunks.length === 0) return;

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

            // Prepend context to embedding text — compute once, reuse for both embeddings and contentHash
            const enrichedTexts = chunks.map((c, idx) =>
              enrichChunkForEmbedding(c, contexts[idx] || undefined),
            );
            const embeddings = await embedTexts(enrichedTexts);

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
                  contentHash: contentHash(enrichedTexts[idx]),
                  indexedAt: new Date().toISOString(),
                },
              };
            });

            await rawQdrant.upsert(COLLECTION, { wait: true, points });
            repoChunks += chunks.length;
          } catch {
            // File was deleted or unreadable — vectors already cleaned up above
          }
        }),
      ),
    );
    totalChunks += repoChunks;
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
}

// --- Step 2: Code review ---

async function codeReview(): Promise<{
  reviewNotes: number;
  commits: number;
  allCommits: Awaited<ReturnType<typeof getMergeCommits>>;
}> {
  const repos = getRepoConfigs();
  if (repos.length === 0) {
    logger.warn("CODEBASE_REPOS not set, skipping code review");
    return { reviewNotes: 0, commits: 0, allCommits: [] };
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
        const langfuse = getLangfuse();
        const trace = langfuse?.trace({
          name: "nightly:codeReview",
          input: { repo: repo.name, commit: commit.sha },
        });
        const generation = trace?.generation({
          name: "codeReview",
          model: "chat",
          input: { commitSha: commit.sha, filesChanged: commit.files.length },
        });

        const { text } = await generateText({
          model: getChatModel(),
          system: CODE_REVIEW_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
          tools: {
            searchStandards: searchStandardsTool,
            searchCode: searchCodeTool,
          },
          stopWhen: stepCountIs(5),
          abortSignal: AbortSignal.timeout(120_000),
        });

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

        generation?.end({ output: { notesCount: notes.length } });

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

  logger.info({ reviewNotes: allNotes.length, commits: allCommits.length }, "Code review complete");
  return {
    reviewNotes: allNotes.length,
    commits: allCommits.length,
    allCommits,
  };
}

// --- Step 3: Test suggestions ---

async function generateTestSuggestions(
  commits: Awaited<ReturnType<typeof getMergeCommits>>,
): Promise<{ suggestions: number }> {
  const repos = getRepoConfigs();
  if (repos.length === 0) {
    logger.warn("CODEBASE_REPOS not set, skipping test suggestions");
    return { suggestions: 0 };
  }

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
        const langfuse = getLangfuse();
        const trace = langfuse?.trace({
          name: "nightly:testSuggestion",
          input: { filePath, commitSha: commit.sha },
        });
        const generation = trace?.generation({
          name: "testSuggestion",
          model: "chat",
          input: { filePath, language: lang },
        });

        const { text } = await generateText({
          model: getChatModel(),
          system: TEST_SUGGESTION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
          abortSignal: AbortSignal.timeout(120_000),
        });

        generation?.end({ output: { hasContent: !!text.trim() } });

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
}

// --- Step 4: Graph rebuild (optional) ---

async function buildGraphStep(): Promise<void> {
  if (!isGraphAvailable()) {
    logger.info("Neo4j not configured, skipping graph rebuild");
    return;
  }
  const repos = getRepoConfigs();
  try {
    const { nodes, edges } = await buildGraph(repos);
    logger.info({ nodes, edges }, "Graph rebuild complete");
  } catch (err) {
    logger.error({ err }, "Graph rebuild failed (non-fatal — nightly pipeline continues)");
  }
}

// --- Nightly review pipeline ---

export async function runNightlyReview(): Promise<{ suggestions: number }> {
  await incrementalReindex();
  const { allCommits } = await codeReview();
  const { suggestions } = await generateTestSuggestions(allCommits);
  await buildGraphStep();
  return { suggestions };
}
