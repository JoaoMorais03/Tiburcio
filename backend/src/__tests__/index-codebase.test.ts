// Tests for the codebase indexing pipeline (per-file architecture).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("p-limit", () => ({
  default: () => {
    // Simple passthrough — runs functions immediately (no real concurrency in tests)
    return <T>(fn: () => Promise<T>) => fn();
  },
}));

vi.mock("../mastra/infra.js", () => ({
  rawQdrant: {
    upsert: vi.fn(),
    delete: vi.fn(),
    createPayloadIndex: vi.fn(),
  },
  ensureCollection: vi.fn(),
}));

vi.mock("../indexer/embed.js", () => ({
  embedTexts: vi.fn(() => [[0.1, 0.2]]),
  toUUID: vi.fn((s: string) => s),
}));

vi.mock("../indexer/contextualize.js", () => ({
  contextualizeChunks: vi.fn((_content: string, chunks: Array<{ content: string }>) =>
    Promise.resolve(chunks.map(() => "mock context")),
  ),
}));

vi.mock("../indexer/bm25.js", () => ({
  textToSparse: vi.fn(() => ({ indices: [1], values: [0.5] })),
}));

vi.mock("../indexer/chunker.js", () => ({
  chunkFile: vi.fn(() => [
    {
      content: "class Foo {}",
      filePath: "src/Foo.java",
      language: "java",
      layer: "service",
      startLine: 1,
      endLine: 1,
      symbolName: "Foo",
      parentSymbol: null,
      chunkType: "class",
      annotations: [],
      chunkIndex: 0,
      totalChunks: 1,
      headerChunkId: null,
    },
  ]),
}));

vi.mock("../indexer/redact.js", () => ({
  redactSecrets: vi.fn((s: string) => s),
}));

vi.mock("../indexer/git-diff.js", () => ({
  getHeadSha: vi.fn(() => "abc123"),
}));

vi.mock("../config/redis.js", () => ({
  redis: { set: vi.fn(), get: vi.fn() },
}));

vi.mock("../config/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    stat: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
  };
});

import { readdir, readFile, stat } from "node:fs/promises";
import { logger } from "../config/logger.js";
import { chunkFile } from "../indexer/chunker.js";
import { contextualizeChunks } from "../indexer/contextualize.js";
import { embedTexts } from "../indexer/embed.js";
import { indexCodebase } from "../indexer/index-codebase.js";
import { ensureCollection, rawQdrant } from "../mastra/infra.js";

describe("indexCodebase", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: codebasePath exists, no .tibignore, one source file
    vi.mocked(stat).mockResolvedValue({} as never);
    vi.mocked(readdir).mockImplementation(async (dir) => {
      const d = String(dir);
      if (d === "/codebase") {
        return [{ name: "src", isDirectory: () => true, isFile: () => false }] as never;
      }
      if (d === "/codebase/src") {
        return [{ name: "Foo.java", isDirectory: () => false, isFile: () => true }] as never;
      }
      return [] as never;
    });
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith(".tibignore")) throw new Error("not found");
      return "class Foo { void bar() {} }";
    });
  });

  it("creates collection before processing files", async () => {
    const callOrder: string[] = [];
    vi.mocked(ensureCollection).mockImplementation(async () => {
      callOrder.push("ensureCollection");
    });
    vi.mocked(rawQdrant.upsert).mockImplementation(async () => {
      callOrder.push("upsert");
      return {} as never;
    });

    await indexCodebase("/codebase", "myrepo");

    expect(callOrder.indexOf("ensureCollection")).toBeLessThan(callOrder.indexOf("upsert"));
  });

  it("purges stale vectors before processing", async () => {
    const callOrder: string[] = [];
    vi.mocked(rawQdrant.delete).mockImplementation(async () => {
      callOrder.push("delete");
      return {} as never;
    });
    vi.mocked(rawQdrant.upsert).mockImplementation(async () => {
      callOrder.push("upsert");
      return {} as never;
    });

    await indexCodebase("/codebase", "myrepo");

    expect(callOrder.indexOf("delete")).toBeLessThan(callOrder.indexOf("upsert"));
  });

  it("processes files and upserts per-file", async () => {
    await indexCodebase("/codebase", "myrepo");

    expect(chunkFile).toHaveBeenCalledOnce();
    expect(embedTexts).toHaveBeenCalledOnce();
    expect(rawQdrant.upsert).toHaveBeenCalledOnce();

    const upsertCall = vi.mocked(rawQdrant.upsert).mock.calls[0];
    expect(upsertCall[0]).toBe("code-chunks");
    const points = (upsertCall[1] as { points: unknown[] }).points;
    expect(points).toHaveLength(1);
  });

  it("skips contextualization for single-chunk small files", async () => {
    // File is small (< 3000 chars) and produces 1 chunk
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith(".tibignore")) throw new Error("not found");
      return "short file";
    });
    vi.mocked(chunkFile).mockReturnValue([
      {
        content: "short file",
        filePath: "src/small.ts",
        language: "typescript",
        layer: "other",
        startLine: 1,
        endLine: 1,
        symbolName: null,
        parentSymbol: null,
        chunkType: "file",
        annotations: [],
        chunkIndex: 0,
        totalChunks: 1,
        headerChunkId: null,
      },
    ]);

    await indexCodebase("/codebase", "myrepo");

    expect(contextualizeChunks).not.toHaveBeenCalled();
  });

  it("passes empty content for header chunks to skip their contextualization", async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith(".tibignore")) throw new Error("not found");
      return "import Foo;\nclass Bar { void baz() {} }";
    });
    vi.mocked(chunkFile).mockReturnValue([
      {
        content: "import Foo;",
        filePath: "src/Bar.java",
        language: "java",
        layer: "service",
        startLine: 1,
        endLine: 1,
        symbolName: null,
        parentSymbol: null,
        chunkType: "header",
        annotations: [],
        chunkIndex: 0,
        totalChunks: 2,
        headerChunkId: null,
      },
      {
        content: "class Bar { void baz() {} }",
        filePath: "src/Bar.java",
        language: "java",
        layer: "service",
        startLine: 2,
        endLine: 2,
        symbolName: "Bar",
        parentSymbol: null,
        chunkType: "class",
        annotations: [],
        chunkIndex: 1,
        totalChunks: 2,
        headerChunkId: null,
      },
    ]);

    await indexCodebase("/codebase", "myrepo");

    expect(contextualizeChunks).toHaveBeenCalledOnce();
    const chunksArg = vi.mocked(contextualizeChunks).mock.calls[0][1];
    // Header chunk should have empty content to skip LLM call
    expect(chunksArg[0].content).toBe("");
    // Non-header chunk keeps its content
    expect(chunksArg[1].content).toBe("class Bar { void baz() {} }");
  });

  it("handles file read errors gracefully", async () => {
    // Override chunkFile to throw for Bad.java (simulating unreadable file)
    vi.mocked(chunkFile).mockImplementation((_content: string, filePath: string) => {
      if (filePath.includes("Bad")) throw new Error("Permission denied");
      return [
        {
          content: "class Good {}",
          filePath,
          language: "java" as const,
          layer: "service",
          startLine: 1,
          endLine: 1,
          symbolName: "Good",
          parentSymbol: null,
          chunkType: "class",
          annotations: [],
          chunkIndex: 0,
          totalChunks: 1,
          headerChunkId: null,
        },
      ];
    });
    vi.mocked(readdir).mockImplementation(async (dir) => {
      const d = String(dir);
      if (d === "/codebase") {
        return [{ name: "src", isDirectory: () => true, isFile: () => false }] as never;
      }
      if (d === "/codebase/src") {
        return [
          { name: "Good.java", isDirectory: () => false, isFile: () => true },
          { name: "Bad.java", isDirectory: () => false, isFile: () => true },
        ] as never;
      }
      return [] as never;
    });

    const result = await indexCodebase("/codebase", "myrepo");

    // Good.java processed (1 chunk), Bad.java skipped (error caught)
    expect(result.chunks).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining("Bad.java") }),
      "Skipped file during indexing after retries exhausted",
    );
  });

  it("logs per-file progress", async () => {
    await indexCodebase("/codebase", "myrepo");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ file: "src/Foo.java", progress: "1/1" }),
      "Indexing file",
    );
  });

  it("returns zero when codebase has no source files", async () => {
    vi.mocked(readdir).mockResolvedValue([] as never);

    const result = await indexCodebase("/codebase", "myrepo");

    expect(result).toEqual({ files: 0, chunks: 0 });
    expect(ensureCollection).not.toHaveBeenCalled();
  });

  it("throws when codebase path does not exist", async () => {
    vi.mocked(stat).mockRejectedValue(new Error("ENOENT"));

    await expect(indexCodebase("/nonexistent", "myrepo")).rejects.toThrow(
      "Codebase path not found: /nonexistent",
    );
  });

  it("retries embedding on transient failure", async () => {
    vi.mocked(embedTexts)
      .mockRejectedValueOnce(new Error("502 Bad Gateway"))
      .mockResolvedValueOnce([[0.1, 0.2]]);

    await indexCodebase("/codebase", "myrepo");

    expect(embedTexts).toHaveBeenCalledTimes(2);
    expect(rawQdrant.upsert).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, maxAttempts: 3 }),
      "Embedding failed, retrying",
    );
  });

  it("retries upsert on transient failure", async () => {
    vi.mocked(rawQdrant.upsert)
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce({} as never);

    await indexCodebase("/codebase", "myrepo");

    expect(rawQdrant.upsert).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, maxAttempts: 3 }),
      "Upsert failed, retrying",
    );
  });

  it("stores HEAD SHA after indexing", async () => {
    const { redis } = await import("../config/redis.js");

    await indexCodebase("/codebase", "myrepo");

    expect(redis.set).toHaveBeenCalledWith("tiburcio:codebase-head:myrepo", "abc123");
  });
});
