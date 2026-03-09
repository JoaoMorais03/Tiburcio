// Tests for RAG tool execute functions (mocked Qdrant + embedding).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../indexer/embed.js", () => ({
  embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

vi.mock("../mastra/infra.js", () => ({
  rawQdrant: {
    search: vi.fn(),
    query: vi.fn(),
    retrieve: vi.fn(),
    scroll: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock("../mastra/tools/git-fallback.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    isCollectionPopulated: vi.fn().mockResolvedValue(false),
    getGitCommitSummaries: vi.fn().mockResolvedValue([
      {
        sha: "abc12345",
        author: "dev1",
        date: "2026-03-08",
        message: "feat: add auth",
        filesChanged: 3,
      },
      {
        sha: "def67890",
        author: "dev2",
        date: "2026-03-07",
        message: "fix: login bug",
        filesChanged: 1,
      },
    ]),
    getRecentTestFiles: vi
      .fn()
      .mockResolvedValue(["src/__tests__/auth.test.ts", "src/__tests__/chat.test.ts"]),
  };
});

vi.mock("../indexer/bm25.js", () => ({
  textToSparse: vi.fn(() => ({ indices: [1, 2], values: [1.0, 1.0] })),
}));

vi.mock("../config/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../config/env.js", () => ({
  env: { EMBEDDING_DIMENSIONS: 3, RETRIEVAL_CONFIDENCE_THRESHOLD: 0.45 },
}));

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

import { readdir, readFile } from "node:fs/promises";
import { embedText } from "../indexer/embed.js";
import { rawQdrant } from "../mastra/infra.js";
import { isCollectionPopulated } from "../mastra/tools/git-fallback.js";

/** Call the execute function from a tool module's exported tool object. */
async function executeTool(
  toolModule: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const mod = await import(toolModule);
  // The tool object from AI SDK has { description, parameters, execute }
  const toolObj = Object.values(mod).find(
    (v): v is { execute: (input: never, ctx: never) => Promise<unknown> } =>
      typeof v === "object" && v !== null && "execute" in v && "description" in v,
  );
  if (!toolObj) throw new Error(`No tool object found in ${toolModule}`);
  const result = await toolObj.execute(input as never, {} as never);
  return result as Record<string, unknown>;
}

/** Qdrant ScoredPoint format used by rawQdrant.search() */
function qdrantHit(score: number, payload: Record<string, unknown>) {
  return { id: "abc-123", version: 0, score, payload };
}

describe("truncate", () => {
  it("returns text unchanged when under the limit", async () => {
    const { truncate } = await import("../mastra/tools/truncate.js");
    expect(truncate("short text")).toBe("short text");
  });

  it("truncates text exceeding the default limit", async () => {
    const { truncate } = await import("../mastra/tools/truncate.js");
    const long = "a".repeat(2000);
    const result = truncate(long);
    expect(result.length).toBeLessThan(2000);
    expect(result).toContain("… (truncated)");
  });

  it("respects a custom max parameter", async () => {
    const { truncate } = await import("../mastra/tools/truncate.js");
    const text = "hello world";
    expect(truncate(text, 5)).toBe("hello\n… (truncated)");
  });

  it("returns empty string unchanged", async () => {
    const { truncate } = await import("../mastra/tools/truncate.js");
    expect(truncate("")).toBe("");
  });
});

describe("RAG tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("searchStandards", () => {
    it("embeds the query and returns mapped results", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([
        qdrantHit(0.92, {
          title: "Error Handling",
          category: "backend",
          text: "Use try/catch...",
          tags: ["error"],
        }),
      ] as never);

      const result = await executeTool("../mastra/tools/search-standards.js", {
        query: "error handling",
        compact: false,
      });

      expect(embedText).toHaveBeenCalledWith("error handling");
      expect(rawQdrant.search).toHaveBeenCalledWith(
        "standards",
        expect.objectContaining({
          vector: [0.1, 0.2, 0.3],
          limit: 5,
        }),
      );

      const results = result.results as Record<string, unknown>[];
      expect(results[0]).toEqual({
        title: "Error Handling",
        category: "backend",
        content: "Use try/catch...",
        tags: ["error"],
        score: 0.92,
      });
    });

    it("passes category filter to Qdrant when provided", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([]);
      await executeTool("../mastra/tools/search-standards.js", {
        query: "vue patterns",
        category: "frontend",
      });

      expect(rawQdrant.search).toHaveBeenCalledWith(
        "standards",
        expect.objectContaining({
          filter: { must: [{ key: "category", match: { value: "frontend" } }] },
        }),
      );
    });

    it("sends NO filter when category is omitted", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([]);
      await executeTool("../mastra/tools/search-standards.js", {
        query: "anything",
      });

      expect(rawQdrant.search).toHaveBeenCalledWith(
        "standards",
        expect.objectContaining({ filter: undefined }),
      );
    });

    it("handles missing payload fields with fallback defaults", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([qdrantHit(0.5, {})] as never);

      const result = await executeTool("../mastra/tools/search-standards.js", {
        query: "anything",
      });
      const results = result.results as Record<string, unknown>[];

      expect(results[0]).toEqual({
        title: "Untitled",
        category: "unknown",
        content: "",
        tags: [],
        score: 0.5,
      });
    });

    it("returns message when no results found", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([]);
      const result = await executeTool("../mastra/tools/search-standards.js", {
        query: "nonexistent",
      });

      expect(result.results as unknown[]).toHaveLength(0);
      expect(result.message).toContain("No matching");
    });
  });

  describe("searchCode", () => {
    it("uses hybrid search and returns enriched results", async () => {
      vi.mocked(rawQdrant.query).mockResolvedValue({
        points: [
          {
            id: "abc-123",
            score: 0.88,
            payload: {
              repo: "api",
              filePath: "src/services/UserService.java",
              language: "java",
              layer: "service",
              startLine: 10,
              endLine: 25,
              text: "public void createUser() { ... }",
              symbolName: "createUser",
              parentSymbol: "UserService",
              chunkType: "method",
              annotations: ["@Transactional"],
              headerChunkId: "hdr-uuid",
            },
          },
        ],
      } as never);

      vi.mocked(rawQdrant.retrieve).mockResolvedValue([
        {
          id: "hdr-uuid",
          payload: { text: "import ...; class UserService {" },
        },
      ] as never);

      const result = await executeTool("../mastra/tools/search-code.js", {
        query: "create user",
        language: "java",
        layer: "service",
        compact: false,
      });

      expect(embedText).toHaveBeenCalledWith("java service create user");
      expect(rawQdrant.query).toHaveBeenCalledWith(
        "code-chunks",
        expect.objectContaining({
          query: { fusion: "rrf" },
          limit: 8,
          with_payload: true,
        }),
      );

      const results = result.results as Record<string, unknown>[];
      expect(results[0]).toMatchObject({
        repo: "api",
        filePath: "src/services/UserService.java",
        language: "java",
        layer: "service",
        code: "public void createUser() { ... }",
        symbolName: "createUser",
        parentSymbol: "UserService",
        chunkType: "method",
        annotations: ["@Transactional"],
        classContext: "import ...; class UserService {",
        score: 0.88,
      });
    });

    it("truncates large code and classContext fields", async () => {
      const largeCode = "x".repeat(3000);
      const largeHeader = "y".repeat(2000);

      vi.mocked(rawQdrant.query).mockResolvedValue({
        points: [
          {
            id: "big-1",
            score: 0.9,
            payload: {
              text: largeCode,
              headerChunkId: "hdr-big",
              chunkType: "method",
            },
          },
        ],
      } as never);

      vi.mocked(rawQdrant.retrieve).mockResolvedValue([
        { id: "hdr-big", payload: { text: largeHeader } },
      ] as never);

      const result = await executeTool("../mastra/tools/search-code.js", {
        query: "big function",
        compact: false,
      });

      const results = result.results as Record<string, unknown>[];
      const code = results[0].code as string;
      const ctx = results[0].classContext as string;

      expect(code.length).toBeLessThan(1600);
      expect(code).toContain("… (truncated)");
      expect(ctx.length).toBeLessThan(900);
      expect(ctx).toContain("… (truncated)");
    });

    it("returns empty results when no matches found", async () => {
      vi.mocked(rawQdrant.query).mockResolvedValue({ points: [] } as never);

      const result = await executeTool("../mastra/tools/search-code.js", {
        query: "anything",
      });

      expect(result.results as unknown[]).toHaveLength(0);
      expect(result.message).toContain("No matching code found");
    });
  });

  describe("getArchitecture", () => {
    it("queries architecture collection and maps results", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([
        qdrantHit(0.9, {
          title: "Auth Flow",
          area: "auth",
          text: "JWT-based authentication...",
          keyFiles: ["AuthController.java", "JwtFilter.java"],
        }),
      ] as never);

      const result = await executeTool("../mastra/tools/get-architecture.js", {
        query: "authentication flow",
      });

      expect(rawQdrant.search).toHaveBeenCalledWith("architecture", expect.any(Object));
      const results = result.results as Record<string, unknown>[];
      expect(results[0]).toMatchObject({ area: "auth" });
      expect(results[0].keyFiles).toEqual(["AuthController.java", "JwtFilter.java"]);
    });

    it("handles missing payload gracefully", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([qdrantHit(0.5, {})] as never);

      const result = await executeTool("../mastra/tools/get-architecture.js", {
        query: "anything",
      });
      const results = result.results as Record<string, unknown>[];

      expect(results[0]).toEqual({
        title: "Untitled",
        area: "unknown",
        content: "",
        keyFiles: [],
        score: 0.5,
      });
    });
  });

  describe("searchSchemas", () => {
    it("queries schemas collection and maps all fields", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([
        qdrantHit(0.87, {
          tableName: "request",
          description: "Main request table",
          text: "CREATE TABLE request...",
          relations: ["project", "user"],
          indexes: ["idx_request_status"],
        }),
      ] as never);

      const result = await executeTool("../mastra/tools/search-schemas.js", {
        query: "request table",
        compact: false,
      });

      expect(rawQdrant.search).toHaveBeenCalledWith("schemas", expect.any(Object));
      const results = result.results as Record<string, unknown>[];
      expect(results[0]).toMatchObject({ tableName: "request" });
      expect(results[0].relations).toContain("project");
      expect(results[0].indexes).toContain("idx_request_status");
    });

    it("passes tableName filter when provided", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([]);
      await executeTool("../mastra/tools/search-schemas.js", {
        query: "columns",
        tableName: "request",
      });

      expect(rawQdrant.search).toHaveBeenCalledWith(
        "schemas",
        expect.objectContaining({
          filter: { must: [{ key: "tableName", match: { value: "request" } }] },
        }),
      );
    });
  });

  describe("searchReviews", () => {
    it("embeds query and returns mapped results with all review fields", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([
        qdrantHit(0.91, {
          text: "Missing error handling in PaymentService",
          severity: "warning",
          category: "bug",
          filePath: "src/services/PaymentService.java",
          commitSha: "abc123",
          author: "dev1",
          date: "2025-05-01",
          mergeMessage: "feat: add payment flow",
        }),
      ] as never);

      const result = await executeTool("../mastra/tools/search-reviews.js", {
        query: "payment issues",
        compact: false,
      });

      expect(embedText).toHaveBeenCalledWith("payment issues");
      expect(rawQdrant.search).toHaveBeenCalledWith(
        "reviews",
        expect.objectContaining({
          vector: [0.1, 0.2, 0.3],
          limit: 8,
        }),
      );

      const results = result.results as Record<string, unknown>[];
      expect(results[0]).toEqual({
        review: "Missing error handling in PaymentService",
        severity: "warning",
        category: "bug",
        filePath: "src/services/PaymentService.java",
        commitSha: "abc123",
        author: "dev1",
        date: "2025-05-01",
        mergeMessage: "feat: add payment flow",
        score: 0.91,
      });
    });

    it("passes severity and category filters to Qdrant", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([]);
      await executeTool("../mastra/tools/search-reviews.js", {
        query: "security issues",
        severity: "critical",
        category: "security",
      });

      expect(rawQdrant.search).toHaveBeenCalledWith(
        "reviews",
        expect.objectContaining({
          filter: {
            must: [
              { key: "severity", match: { value: "critical" } },
              { key: "category", match: { value: "security" } },
            ],
          },
        }),
      );
    });

    it("sends no filter when severity and category are omitted", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([]);
      await executeTool("../mastra/tools/search-reviews.js", {
        query: "anything",
      });

      expect(rawQdrant.search).toHaveBeenCalledWith(
        "reviews",
        expect.objectContaining({ filter: undefined }),
      );
    });

    it("handles missing payload with fallback defaults", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([qdrantHit(0.5, {})] as never);

      const result = await executeTool("../mastra/tools/search-reviews.js", {
        query: "anything",
        compact: false,
      });
      const results = result.results as Record<string, unknown>[];

      expect(results[0]).toEqual({
        review: "",
        severity: "info",
        category: "unknown",
        filePath: "unknown",
        commitSha: "",
        author: "unknown",
        date: "",
        mergeMessage: "",
        score: 0.5,
      });
    });

    it("returns recovery guidance when no results found", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([]);
      vi.mocked(isCollectionPopulated).mockResolvedValueOnce(true);
      const result = await executeTool("../mastra/tools/search-reviews.js", {
        query: "nonexistent",
        severity: "critical",
      });

      expect(result.results as unknown[]).toHaveLength(0);
      expect(result.message).toContain("No review insights found");
      expect(result.message).toContain("removing the severity/category filter");
    });
  });

  describe("getTestSuggestions", () => {
    it("embeds language+query and returns mapped results", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([
        qdrantHit(0.85, {
          text: "describe('PaymentService', () => { ... })",
          targetFile: "src/services/PaymentService.java",
          testType: "unit",
          language: "java",
          commitSha: "def456",
          date: "2025-05-01",
        }),
      ] as never);

      const result = await executeTool("../mastra/tools/get-test-suggestions.js", {
        query: "payment service",
        language: "java",
        compact: false,
      });

      expect(embedText).toHaveBeenCalledWith("java payment service");
      expect(rawQdrant.search).toHaveBeenCalledWith(
        "test-suggestions",
        expect.objectContaining({
          vector: [0.1, 0.2, 0.3],
          limit: 5,
          filter: { must: [{ key: "language", match: { value: "java" } }] },
        }),
      );

      const results = result.results as Record<string, unknown>[];
      expect(results[0]).toEqual({
        suggestion: "describe('PaymentService', () => { ... })",
        targetFile: "src/services/PaymentService.java",
        testType: "unit",
        language: "java",
        commitSha: "def456",
        date: "2025-05-01",
        score: 0.85,
      });
    });

    it("sends no filter when language is omitted", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([]);
      await executeTool("../mastra/tools/get-test-suggestions.js", {
        query: "anything",
      });

      expect(rawQdrant.search).toHaveBeenCalledWith(
        "test-suggestions",
        expect.objectContaining({ filter: undefined }),
      );
    });

    it("handles missing payload with fallback defaults", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([qdrantHit(0.5, {})] as never);

      const result = await executeTool("../mastra/tools/get-test-suggestions.js", {
        query: "anything",
        compact: false,
      });
      const results = result.results as Record<string, unknown>[];

      expect(results[0]).toEqual({
        suggestion: "",
        targetFile: "unknown",
        testType: "unit",
        language: "unknown",
        commitSha: "",
        date: "",
        score: 0.5,
      });
    });

    it("returns recovery guidance when no results found", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([]);
      vi.mocked(isCollectionPopulated).mockResolvedValueOnce(true);
      const result = await executeTool("../mastra/tools/get-test-suggestions.js", {
        query: "nonexistent",
        language: "java",
      });

      expect(result.results as unknown[]).toHaveLength(0);
      expect(result.message).toContain("No test suggestions found");
      expect(result.message).toContain("removing the language filter");
    });

    it("embeds only query when language is omitted", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([]);
      await executeTool("../mastra/tools/get-test-suggestions.js", {
        query: "auth flow",
      });

      expect(embedText).toHaveBeenCalledWith("auth flow");
    });
  });

  describe("getPattern", () => {
    it("lists all .md patterns with titles parsed from headings", async () => {
      vi.mocked(readdir).mockResolvedValue([
        "new-api-endpoint.md",
        "new-batch-job.md",
        "ignore.txt",
      ] as never);
      vi.mocked(readFile)
        .mockResolvedValueOnce("# New API Endpoint\nSteps to create..." as never)
        .mockResolvedValueOnce("# New Batch Job\nSteps to create..." as never);

      const result = await executeTool("../mastra/tools/get-pattern.js", {});

      expect(result.mode).toBe("list");
      const patterns = result.patterns as Record<string, string>[];
      expect(patterns).toHaveLength(2);
      expect(patterns[0].name).toBe("new-api-endpoint");
      expect(patterns[0].title).toBe("New API Endpoint");
      expect(patterns[1].name).toBe("new-batch-job");
    });

    it("returns specific pattern content by name", async () => {
      vi.mocked(readFile).mockResolvedValue(
        "# New Batch Job\n\nCreate a scheduled batch..." as never,
      );

      const result = await executeTool("../mastra/tools/get-pattern.js", {
        name: "new-batch-job",
      });

      expect(result.mode).toBe("detail");
      expect(result.found).toBe(true);
      expect(result.content).toContain("New Batch Job");
      expect(readFile).toHaveBeenCalledWith(expect.stringContaining("new-batch-job.md"), "utf-8");
    });

    it("returns available list when pattern not found", async () => {
      vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
      vi.mocked(readdir).mockResolvedValue(["new-api-endpoint.md", "new-batch-job.md"] as never);

      const result = await executeTool("../mastra/tools/get-pattern.js", {
        name: "nonexistent",
      });

      expect(result.found).toBe(false);
      expect(result.message).toContain("nonexistent");
      const available = result.availablePatterns as string[];
      expect(available).toContain("new-api-endpoint");
      expect(available).toContain("new-batch-job");
    });
  });

  describe("git fallbacks", () => {
    it("searchReviews falls back to git commits when collection is empty", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([]);

      const result = await executeTool("../mastra/tools/search-reviews.js", {
        query: "recent changes",
      });

      expect(result.source).toBe("git-log");
      expect(result.notice).toContain("git history");
      const results = result.results as Record<string, unknown>[];
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].summary).toBe("feat: add auth");
    });

    it("getTestSuggestions falls back to recently changed test files when collection is empty", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([]);

      const result = await executeTool("../mastra/tools/get-test-suggestions.js", {
        query: "auth tests",
      });

      expect(result.source).toBe("git-log");
      expect(result.notice).toContain("git history");
      const results = result.results as Record<string, unknown>[];
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].targetFile).toBe("src/__tests__/auth.test.ts");
    });

    it("getNightlySummary falls back to git commit summaries when collections are empty", async () => {
      vi.mocked(rawQdrant.scroll as ReturnType<typeof vi.fn>).mockResolvedValue({ points: [] });

      const { executeGetNightlySummary } = await import("../mastra/tools/get-nightly-summary.js");
      const result = await executeGetNightlySummary(1);

      expect(result.source).toBe("git-log");
      expect(result.notice).toContain("git history");
      expect(result.summary).toContain("2 commit(s)");
      expect(result.recentCommits).toHaveLength(2);
    });

    it("searchStandards returns low-confidence results with flag instead of empty", async () => {
      vi.mocked(rawQdrant.search).mockResolvedValue([
        qdrantHit(0.3, { title: "Low Match", text: "Some content", category: "backend", tags: [] }),
      ] as never);

      const result = await executeTool("../mastra/tools/search-standards.js", {
        query: "something obscure",
      });

      expect(result.lowConfidence).toBe(true);
      expect(result.notice).toContain("low relevance");
      const results = result.results as Record<string, unknown>[];
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Low Match");
    });
  });
});
