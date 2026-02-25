// Tests for contextual retrieval (LLM context generation per chunk).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../mastra/infra.js", () => ({
  openrouter: { chat: vi.fn(() => ({})) },
}));

vi.mock("../config/env.js", () => ({
  env: {
    OPENROUTER_MODEL: "test-model",
    OPENROUTER_PROVIDER: "test-provider",
  },
}));

vi.mock("../config/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

import { generateText } from "ai";
import { contextualizeChunk, contextualizeChunks } from "../indexer/contextualize.js";

describe("contextualizeChunk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns LLM-generated context for a chunk", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "This method handles user creation in the service layer.",
    } as never);

    const result = await contextualizeChunk(
      "class UserService { createUser() { ... } }",
      "createUser() { ... }",
      "src/services/UserService.java",
      "java",
    );

    expect(result).toBe("This method handles user creation in the service layer.");
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("returns empty string on LLM failure", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("API error"));

    const result = await contextualizeChunk(
      "file content",
      "chunk content",
      "test.ts",
      "typescript",
    );

    expect(result).toBe("");
  });

  it("trims whitespace from response", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "  context with spaces  \n",
    } as never);

    const result = await contextualizeChunk("file", "chunk", "test.ts", "typescript");
    expect(result).toBe("context with spaces");
  });
});

describe("contextualizeChunks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("processes multiple chunks sequentially", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "Context for chunk 1" } as never)
      .mockResolvedValueOnce({ text: "Context for chunk 2" } as never)
      .mockResolvedValueOnce({ text: "Context for chunk 3" } as never);

    const chunks = [{ content: "chunk1" }, { content: "chunk2" }, { content: "chunk3" }];

    const results = await contextualizeChunks("full file", chunks, "test.ts", "typescript");

    expect(results).toEqual(["Context for chunk 1", "Context for chunk 2", "Context for chunk 3"]);
    expect(generateText).toHaveBeenCalledTimes(3);
  });

  it("returns empty strings for failed chunks without stopping", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "Context 1" } as never)
      .mockRejectedValueOnce(new Error("API error"))
      .mockResolvedValueOnce({ text: "Context 3" } as never);

    const chunks = [{ content: "a" }, { content: "b" }, { content: "c" }];

    const results = await contextualizeChunks("full file", chunks, "test.ts", "typescript");

    expect(results).toEqual(["Context 1", "", "Context 3"]);
  });
});
