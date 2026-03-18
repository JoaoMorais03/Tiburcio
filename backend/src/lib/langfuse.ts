// lib/langfuse.ts — Langfuse observability singleton.
// Lazy-initialized: returns null when LANGFUSE_SECRET_KEY is not set.
// When LANGFUSE_RECORD_IO is "false", disables input/output recording for privacy.

import { Langfuse } from "langfuse";

import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

let instance: Langfuse | null | undefined;
let recordIO = true;

/** Whether input/output recording is enabled (LANGFUSE_RECORD_IO !== "false"). */
export function isRecordIOEnabled(): boolean {
  return recordIO;
}

/** Get the Langfuse client singleton. Returns null if not configured. */
export function getLangfuse(): Langfuse | null {
  if (instance !== undefined) return instance;

  if (!env.LANGFUSE_SECRET_KEY || !env.LANGFUSE_PUBLIC_KEY) {
    instance = null;
    return null;
  }

  recordIO = env.LANGFUSE_RECORD_IO !== "false";

  instance = new Langfuse({
    secretKey: env.LANGFUSE_SECRET_KEY,
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    baseUrl: env.LANGFUSE_BASE_URL,
  });

  logger.info({ recordIO }, "Langfuse initialized");
  return instance;
}

/** Whether Langfuse is configured (keys are set). */
export function isLangfuseConfigured(): boolean {
  return !!(env.LANGFUSE_SECRET_KEY && env.LANGFUSE_PUBLIC_KEY);
}

/** Flush pending events and shut down the Langfuse client. */
export async function shutdownLangfuse(): Promise<void> {
  if (instance) {
    await instance.shutdownAsync();
    instance = undefined;
    logger.info("Langfuse shut down");
  }
}

/**
 * Wrap an MCP tool call with a Langfuse trace + span.
 * If Langfuse is not configured, executes the function directly.
 */
export async function traceToolCall<T>(
  toolName: string,
  input: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const langfuse = getLangfuse();
  if (!langfuse) return fn();

  const trace = langfuse.trace({
    name: `mcp:${toolName}`,
    ...(recordIO && { input }),
    metadata: { transport: "mcp" },
  });

  const span = trace.span({
    name: toolName,
    ...(recordIO && { input }),
  });

  try {
    const result = await fn();
    try {
      span.end(recordIO ? { output: { data: result } } : {});
      trace.update(recordIO ? { output: { data: result } } : {});
    } catch {
      /* observability must never crash MCP tools */
    }
    return result;
  } catch (err) {
    try {
      span.end({
        level: "ERROR",
        statusMessage: err instanceof Error ? err.message : String(err),
      });
      trace.update({
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    } catch {
      /* observability must never crash MCP tools */
    }
    throw err;
  }
}
