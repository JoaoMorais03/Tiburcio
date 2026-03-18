---
title: "feat: Enable Langfuse Observability Instrumentation"
type: feat
status: active
date: 2026-03-08
---

# Enable Langfuse Observability Instrumentation

## Overview

Wire up Langfuse tracing so you can see exactly what Claude Code is doing with Tiburcio's 10 MCP tools — which tools get called, how often, token costs, latency, and errors. The Docker Compose service and env vars already exist; what's missing is the actual instrumentation layer in the backend code.

## Problem Statement / Motivation

Right now Tiburcio is a black box. When Claude Code calls `searchCode` or `getArchitecture`, you have no visibility into:
- **Which tools Claude prefers** — is it using `searchStandards` 50 times and ignoring `getPattern`?
- **Token costs** — how much does each tool call cost via OpenRouter? How much does the nightly pipeline burn?
- **Latency** — are embedding calls taking 200ms or 2 seconds? Is Qdrant fast enough?
- **Errors** — are tool calls silently failing? Are embedding timeouts happening?
- **Usage patterns** — does Claude call tools in bursts or spread throughout the session?

This data is critical for the improvements plan (P1.1-P2.7) — you can't optimize what you can't measure. And as the "buyer" of Tiburcio, I want to see whether tool calls are actually faster than my built-in Grep/Read before committing to using them.

## Proposed Solution

Use the native **`langfuse` Node.js SDK** (not OpenTelemetry) to instrument 4 categories of operations:

1. **MCP tool executions** (10 tools) — trace each `executeFoo()` call with input/output, latency, errors
2. **LLM generation calls** (4 sites) — trace `generateText`/`streamText` with token usage and cost
3. **Embedding calls** (2 functions) — trace `embed`/`embedMany` with token counts
4. **Nightly pipeline** — trace the full pipeline as one trace with child spans per operation

### Why native SDK, not OpenTelemetry?

- AI SDK's `experimental_telemetry` only covers `generateText`/`streamText` — it does NOT cover MCP tool execution, which is the primary thing we want to observe
- `embed()`/`embedMany()` may not support `experimental_telemetry` in AI SDK v6
- The native SDK gives us explicit control over trace hierarchy, naming, and metadata
- One consistent approach across all 4 categories is simpler than mixing OTel + manual spans

## Technical Considerations

### Architecture: `lib/langfuse.ts` singleton

Following the single-source-of-truth pattern (`infra.ts` for Qdrant, `model-provider.ts` for LLM), create a new `lib/langfuse.ts` that:

```typescript
// backend/src/lib/langfuse.ts
import { Langfuse } from "langfuse";
import { env } from "../config/env.js";

let instance: Langfuse | null = null;

/** Lazy-init Langfuse client. Returns null if not configured. */
export function getLangfuse(): Langfuse | null {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY || !env.LANGFUSE_BASE_URL) {
    return null;
  }
  if (!instance) {
    instance = new Langfuse({
      publicKey: env.LANGFUSE_PUBLIC_KEY,
      secretKey: env.LANGFUSE_SECRET_KEY,
      baseUrl: env.LANGFUSE_BASE_URL,
      flushAt: 15,
      flushInterval: 5000,
    });
  }
  return instance;
}

/** Flush pending events. Call on shutdown. */
export async function shutdownLangfuse(): Promise<void> {
  if (instance) await instance.shutdownAsync();
}

/** Wrap an MCP tool execution with a Langfuse trace. No-op if Langfuse is not configured. */
export async function traceToolCall<T>(
  toolName: string,
  input: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const lf = getLangfuse();
  if (!lf) return fn();

  const trace = lf.trace({ name: `mcp.${toolName}`, input, metadata: { transport: "mcp" } });
  const span = trace.span({ name: "execute", input });
  try {
    const result = await fn();
    span.end({ output: result });
    return result;
  } catch (err) {
    span.end({ statusMessage: String(err), level: "ERROR" });
    throw err;
  }
}
```

### Trace Hierarchy

| Category | Trace Name | Child Spans | Metadata |
|----------|-----------|-------------|----------|
| MCP tool call | `mcp.searchCode` | `embedText`, `qdrant.query` | `transport: stdio\|sse`, tool input |
| Chat LLM call | `chat.stream` | `streamText` (auto from AI SDK if possible) | `userId`, `conversationId` |
| Nightly pipeline | `nightly.review` | `reindex`, `review.{commitSha}`, `testSuggestions` | `commitCount`, `fileCount` |
| Indexing | `indexing.codebase` | `file.{path}` (contextualize + embed) | `repo`, `fileCount` |

### Instrumentation Points

| File | What to wrap | How |
|------|-------------|-----|
| `mcp-tools.ts` | All 10 `executeFoo()` calls | Wrap with `traceToolCall(name, input, fn)` |
| `routes/chat.ts` | `streamText()` call | Create trace with `userId` + `conversationId`, pass to AI SDK `experimental_telemetry` if supported |
| `indexer/embed.ts` | `embed()` and `embedMany()` | Wrap with Langfuse `generation()` span (type: "embedding") |
| `mastra/workflows/nightly-review.ts` | Two `generateText()` calls | Wrap with trace + generation spans |
| `indexer/contextualize.ts` | `generateText()` call | Wrap with generation span under parent indexing trace |
| `jobs/queue.ts` | Job execution | Create parent trace for each job type |

### Graceful Degradation

- **Not configured** (no env vars): `getLangfuse()` returns `null`, `traceToolCall()` is a no-op passthrough. Zero overhead.
- **Configured but Langfuse is down**: The Langfuse SDK is fire-and-forget — it queues events in memory and flushes async. Failed flushes are logged and discarded. Backend continues normally.
- **SDK exceptions**: All Langfuse calls are wrapped in try/catch. A tracing failure never breaks a tool call.
- **Health check**: Add `checks.langfuse` to `/api/health` response when configured, but do NOT include it in the `status: "ok"` determination. Langfuse being down is informational, not critical.

### Stdio Process Lifecycle

The `mcp.ts` stdio process has no server lifecycle. Add shutdown handlers:

```typescript
// backend/src/mcp.ts — add after server.connect()
import { shutdownLangfuse } from "./lib/langfuse.js";

process.on("SIGTERM", async () => { await shutdownLangfuse(); process.exit(0); });
process.on("SIGINT", async () => { await shutdownLangfuse(); process.exit(0); });
```

Also use shorter flush settings for stdio (`flushInterval: 1000`) since the process may be short-lived.

### First-Time Setup Flow

The Docker Compose already pre-seeds Langfuse with default keys:
- `LANGFUSE_INIT_PROJECT_PUBLIC_KEY=pk-lf-local`
- `LANGFUSE_INIT_PROJECT_SECRET_KEY=sk-lf-local`

These must match what the backend sends. The `.env.example` should include:

```bash
# ── Observability (optional) ──────────────────────────────
# Start Langfuse: docker compose --profile observability up -d
# Dashboard: http://localhost:3001 (admin@tiburcio.local / admin123)
# LANGFUSE_PUBLIC_KEY=pk-lf-local
# LANGFUSE_SECRET_KEY=sk-lf-local
# LANGFUSE_BASE_URL=http://localhost:3001
```

For stdio MCP, add these `-e` flags:
```bash
-e "LANGFUSE_PUBLIC_KEY=pk-lf-local" \
-e "LANGFUSE_SECRET_KEY=sk-lf-local" \
-e "LANGFUSE_BASE_URL=http://localhost:3001"
```

For Docker backend, add to docker-compose.yml environment:
```yaml
LANGFUSE_BASE_URL: http://langfuse:3000  # Docker service name, not localhost
```

### Sensitive Data

- Self-hosted Langfuse keeps all data local — no third-party exposure
- Add `LANGFUSE_RECORD_IO` env var (default `true`) to control whether prompt/response content is stored in traces
- If set to `false`, traces still record metadata (tool name, latency, token count, cost) but not the actual text
- `redactSecrets()` is already applied before embedding and LLM calls, so secret values won't appear in traces

### Token Cost with Ollama

Ollama may not return `usage` metadata in API responses. When using `MODEL_PROVIDER=ollama`:
- Traces will show latency and success/failure but may show `tokens: 0` and `cost: $0.00`
- Document this limitation: "Cost tracking requires an OpenAI-compatible provider (OpenRouter, vLLM)"
- The Langfuse dashboard is still useful for latency and error rate analysis even without token data

## System-Wide Impact

- **Interaction graph**: `traceToolCall()` wraps `executeFoo()` → Qdrant search → result formatting. No change to the data flow, only observation added.
- **Error propagation**: Langfuse failures are caught and logged. They never propagate to tool callers. The `traceToolCall` wrapper re-throws the original error after recording it.
- **State lifecycle risks**: Langfuse SDK batches events in memory. Abnormal process termination loses buffered events (at most `flushInterval` worth). This is acceptable — observability data loss is not critical.
- **API surface parity**: Both stdio (`mcp.ts`) and HTTP/SSE (`routes/mcp.ts`) use the same `registerTools()` → `executeFoo()` path. Instrumenting `mcp-tools.ts` covers both transports.
- **Integration test scenarios**: (1) Tool call with Langfuse configured → trace appears in Langfuse API. (2) Tool call with Langfuse down → tool returns normally, no error. (3) Stdio process SIGTERM → events flushed before exit.

## Acceptance Criteria

- [ ] `langfuse` npm package added to `backend/package.json`
- [ ] `backend/src/lib/langfuse.ts` exports `getLangfuse()`, `shutdownLangfuse()`, `traceToolCall()`
- [ ] All 10 MCP tool calls wrapped with `traceToolCall()` in `mcp-tools.ts`
- [ ] `embed()` and `embedMany()` calls in `embed.ts` create Langfuse generation spans
- [ ] `generateText()` calls in `nightly-review.ts` and `contextualize.ts` create generation spans
- [ ] `streamText()` in `chat.ts` creates a trace with `userId` and `conversationId`
- [ ] `shutdownLangfuse()` called in `mcp.ts` (SIGTERM/SIGINT) and `server.ts` (existing shutdown)
- [ ] `.env.example` documents `LANGFUSE_*` vars with matching Docker Compose defaults
- [ ] Docker Compose backend environment overrides `LANGFUSE_BASE_URL` to `http://langfuse:3000`
- [ ] `/api/health` includes `checks.langfuse` when configured (does not affect `status`)
- [ ] Backend starts and all tools work when Langfuse env vars are NOT set (zero overhead)
- [ ] Backend starts and all tools work when Langfuse is DOWN but env vars ARE set (graceful degradation)
- [ ] `LANGFUSE_RECORD_IO` env var controls whether prompt/response content is stored
- [ ] README updated: Observability section reflects active instrumentation (remove "not yet active")
- [ ] Existing tests pass without Langfuse env vars (no test regressions)
- [ ] New test: `vi.mock("../lib/langfuse.js")` pattern documented and used
- [ ] All changes pass `pnpm check && pnpm test`

## Success Metrics

After enabling Langfuse, the user should be able to answer these questions from the dashboard:

1. **"Which MCP tools does Claude Code actually use?"** → Trace count per tool name
2. **"How much does the nightly pipeline cost?"** → Sum of token costs for `nightly.review` traces
3. **"What's the average latency per tool call?"** → P50/P95 latency for `mcp.*` traces
4. **"Are any tools failing silently?"** → Error rate per tool
5. **"How many embedding calls per indexing run?"** → Generation count under `indexing.codebase` trace

## Dependencies & Risks

| Risk | Mitigation |
|------|-----------|
| `langfuse` SDK adds cold start latency | Lazy init — SDK only loads when first trace is created |
| Shared PostgreSQL with Langfuse (table collision risk) | Already mitigated: Tiburcio uses `tb_` prefix. Langfuse uses its own schema. |
| Langfuse v2 → v3 migration breaks API | Pin `langfuse` SDK version in package.json |
| Ollama doesn't report token usage | Document limitation; dashboard still shows latency/errors |
| stdio process killed without flush | SIGTERM/SIGINT handlers + short `flushInterval` (1s). Accept some data loss. |
| `LANGFUSE_BASE_URL` differs between Docker and local | Document both values; Docker Compose override handles Docker case |

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `backend/package.json` | Modify | Add `langfuse` dependency |
| `backend/src/lib/langfuse.ts` | **Create** | Singleton client, `traceToolCall()`, `shutdownLangfuse()` |
| `backend/src/config/env.ts` | Modify | Add `LANGFUSE_RECORD_IO` (optional boolean, default true) |
| `backend/src/mcp-tools.ts` | Modify | Wrap 10 `executeFoo()` calls with `traceToolCall()` |
| `backend/src/indexer/embed.ts` | Modify | Add Langfuse generation spans around `embed()`/`embedMany()` |
| `backend/src/mastra/workflows/nightly-review.ts` | Modify | Add trace + generation spans |
| `backend/src/indexer/contextualize.ts` | Modify | Add generation span |
| `backend/src/routes/chat.ts` | Modify | Add trace with userId/conversationId |
| `backend/src/jobs/queue.ts` | Modify | Add parent trace per job type |
| `backend/src/mcp.ts` | Modify | Add SIGTERM/SIGINT → `shutdownLangfuse()` |
| `backend/src/server.ts` | Modify | Add `shutdownLangfuse()` to existing shutdown |
| `backend/src/routes/admin.ts` or `server.ts` | Modify | Add `checks.langfuse` to health endpoint |
| `.env.example` | Modify | Add documented `LANGFUSE_*` vars with defaults |
| `docker-compose.yml` | Modify | Add `LANGFUSE_BASE_URL: http://langfuse:3000` to backend env |
| `README.md` | Modify | Update Observability section, remove "not yet active" |
| `CLAUDE.md` | Modify | Add Langfuse instrumentation to Architecture section |
| `backend/src/__tests__/langfuse.test.ts` | **Create** | Test lazy init, no-op when unconfigured, trace creation |

## Sources & References

- Existing Langfuse Docker service: `docker-compose.yml:57-93`
- Env var declarations: `backend/src/config/env.ts:34-36`
- v2.1 plan (Mastra removal, observability deferred): `docs/plans/2026-03-05-feat-v2-1-mastra-removal-rag-hardening-graph-plan.md:108`
- Docs drift todo (Langfuse not wired): `todos/011-pending-p2-docs-drift-major.md:24`
- Existing table prefix for DB coexistence: `backend/src/db/schema.ts:3`
- Setup guide: `docs/solutions/integration-issues/local-openrouter-mcp-setup.md`
