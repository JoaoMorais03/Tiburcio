// jobs/queue.ts — BullMQ job queue for background indexing and nightly pipeline.

import { join } from "node:path";
import { Queue, Worker } from "bullmq";

import { env, getRepoConfigs } from "../config/env.js";
import { logger } from "../config/logger.js";
import { indexArchitecture } from "../indexer/index-architecture.js";
import { indexCodebase } from "../indexer/index-codebase.js";
import { indexStandards } from "../indexer/index-standards.js";
import { nightlyReviewWorkflow } from "../mastra/workflows/nightly-review.js";

export type IndexJobName =
  | "index-standards"
  | "index-codebase"
  | "index-architecture"
  | "nightly-review";

const connection = { url: env.REDIS_URL };

export const indexQueue = new Queue<Record<string, never>, void, IndexJobName>("indexing", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

async function runJob(jobName: IndexJobName): Promise<void> {
  const standardsDir = join(process.cwd(), "..", "standards");

  switch (jobName) {
    case "index-standards": {
      await indexStandards(standardsDir);
      break;
    }
    case "index-codebase": {
      const repos = getRepoConfigs();
      if (repos.length === 0) throw new Error("CODEBASE_REPOS not configured");
      for (const repo of repos) {
        await indexCodebase(repo.path, repo.name);
      }
      break;
    }
    case "index-architecture": {
      await indexArchitecture(standardsDir);
      break;
    }
    case "nightly-review": {
      const run = await nightlyReviewWorkflow.createRun();
      const result = await run.start({ inputData: {} });
      if (result.status !== "success") {
        throw new Error(`Nightly review finished with status: ${result.status}`);
      }
      break;
    }
  }
}

export async function scheduleNightlyJobs(): Promise<void> {
  // Remove existing repeatable jobs to avoid duplicates on restart
  const existing = await indexQueue.getRepeatableJobs();
  for (const job of existing) {
    await indexQueue.removeRepeatableByKey(job.key);
  }

  // Nightly pipeline at 2:00 AM — runs incremental reindex + code review + test suggestions
  await indexQueue.add("nightly-review", {} as Record<string, never>, {
    repeat: { pattern: "0 2 * * *" },
    jobId: "nightly-review",
  });

  // Full re-index of standards and architecture at 2:00 AM (lightweight, always runs)
  await indexQueue.add("index-standards", {} as Record<string, never>, {
    repeat: { pattern: "0 2 * * *" },
    jobId: "nightly-standards",
  });

  await indexQueue.add("index-architecture", {} as Record<string, never>, {
    repeat: { pattern: "0 2 * * *" },
    jobId: "nightly-architecture",
  });

  logger.info("Nightly jobs scheduled (2:00 AM daily)");
}

export function startIndexWorker(): Worker<Record<string, never>, void, IndexJobName> {
  const worker = new Worker<Record<string, never>, void, IndexJobName>(
    "indexing",
    async (job) => {
      logger.info({ jobName: job.name, jobId: job.id }, "Starting indexing job");
      await runJob(job.name);
      logger.info({ jobName: job.name, jobId: job.id }, "Indexing job completed");
    },
    {
      connection,
      concurrency: 1,
      lockDuration: 300_000,
      lockRenewTime: 60_000,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobName: job?.name, jobId: job?.id, error: err.message }, "Indexing job failed");
  });

  return worker;
}
