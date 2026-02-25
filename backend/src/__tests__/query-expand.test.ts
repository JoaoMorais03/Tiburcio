// Tests for query expansion (LLM-based query variant generation).

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

// Mock the AI SDK generateText
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

import { generateText } from "ai";
import { expandQuery } from "../indexer/query-expand.js";

describe("expandQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns original query plus LLM-generated variants", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '["JWT token validation", "bearer authentication middleware"]',
    } as never);

    const result = await expandQuery("how does authentication work?");

    expect(result).toContain("how does authentication work?");
    expect(result).toContain("JWT token validation");
    expect(result).toContain("bearer authentication middleware");
    expect(result.length).toBe(3);
  });

  it("deduplicates variants that match the original query", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '["how does authentication work?", "auth flow"]',
    } as never);

    const result = await expandQuery("how does authentication work?");
    // Original + deduplicated = only 2
    expect(result).toEqual(["how does authentication work?", "auth flow"]);
  });

  it("falls back to original query on LLM failure", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("API error"));

    const result = await expandQuery("test query");
    expect(result).toEqual(["test query"]);
  });

  it("falls back to original query on invalid JSON", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "not valid json at all",
    } as never);

    const result = await expandQuery("test query");
    expect(result).toEqual(["test query"]);
  });

  it("falls back when regex match contains invalid JSON", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "here is the result [not, valid, json]",
    } as never);

    const result = await expandQuery("test query");
    expect(result).toEqual(["test query"]);
  });

  it("extracts JSON from code fences", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '```json\n["variant one", "variant two"]\n```',
    } as never);

    const result = await expandQuery("original");
    expect(result).toContain("original");
    expect(result).toContain("variant one");
    expect(result).toContain("variant two");
  });
});
