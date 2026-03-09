# Pattern: New BullMQ Job

## Steps

1. **Add the job name** to the `IndexJobName` union type in `backend/src/jobs/queue.ts`:
   ```typescript
   export type IndexJobName =
     | "index-standards"
     | "index-codebase"
     | "index-architecture"
     | "nightly-review"
     | "index-foo";
   ```

2. **Import the job function** and add a case to `runJob()`:
   ```typescript
   import { indexFoo } from "../indexer/index-foo.js";

   async function runJob(jobName: IndexJobName): Promise<void> {
     switch (jobName) {
       // ... existing cases
       case "index-foo": {
         await indexFoo();
         break;
       }
     }
   }
   ```

3. **Add a cron schedule** in `scheduleNightlyJobs()` for recurring jobs:
   ```typescript
   await indexQueue.add("index-foo", {} as Record<string, never>, {
     repeat: { pattern: "0 3 * * *" },
     jobId: "nightly-foo",
   });
   ```

4. **Or expose a queue function** for on-demand triggering:
   ```typescript
   export async function queueFoo(
     jobId = `index-foo-${Date.now()}`,
   ): Promise<void> {
     await indexQueue.add("index-foo", {} as Record<string, never>, { jobId });
     logger.info({ jobId }, "Queued on-demand foo indexing job");
   }
   ```

5. **Add auto-index check** in `server.ts` startup to queue the job if the collection is empty:
   ```typescript
   const collections = await listCollections();
   if (!collections.includes("foo")) {
     await indexQueue.add("index-foo", {} as Record<string, never>, {
       jobId: "boot-foo",
     });
   }
   ```

6. **Wire admin trigger** in `routes/admin.ts` if the job should be triggerable via API:
   ```typescript
   case "index-foo":
     await indexQueue.add("index-foo", {} as Record<string, never>, {
       jobId: `admin-foo-${Date.now()}`,
     });
     break;
   ```

## Conventions
- Worker runs with `concurrency: 1` — jobs execute sequentially to avoid overwhelming inference APIs
- `lockDuration: 300_000` (5 min) and `lockRenewTime: 60_000` (1 min) prevent stalled-job detection during long runs
- Default retry: 3 attempts with exponential backoff (5s base)
- Job names use kebab-case prefixed with `index-` or describe the pipeline (e.g., `nightly-review`)
- Langfuse traces are automatically created by the worker for every job — no manual tracing needed
- All job functions call indexer logic directly — no intermediate abstraction layer
