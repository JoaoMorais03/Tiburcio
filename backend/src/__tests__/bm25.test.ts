// Tests for BM25 tokenizer (sparse vector generation for Qdrant).

import { describe, expect, it } from "vitest";
import { textToSparse, tokenize } from "../indexer/bm25.js";

describe("BM25 tokenizer", () => {
  describe("tokenize", () => {
    it("splits camelCase into separate words", () => {
      const tokens = tokenize("processPayment");
      expect(tokens).toContain("process");
      expect(tokens).toContain("payment");
    });

    it("splits PascalCase into separate words", () => {
      const tokens = tokenize("OrderServiceImpl");
      expect(tokens).toContain("order");
      expect(tokens).toContain("service");
      expect(tokens).toContain("impl");
    });

    it("splits snake_case into separate words", () => {
      const tokens = tokenize("get_user_by_id");
      expect(tokens).toContain("get");
      expect(tokens).toContain("user");
      expect(tokens).toContain("id");
    });

    it("removes stop words", () => {
      const tokens = tokenize("the user is in a service");
      expect(tokens).not.toContain("the");
      expect(tokens).not.toContain("is");
      expect(tokens).not.toContain("in");
      expect(tokens).not.toContain("a");
      expect(tokens).toContain("user");
      expect(tokens).toContain("service");
    });

    it("removes single-character tokens", () => {
      const tokens = tokenize("a b c hello");
      expect(tokens).toEqual(["hello"]);
    });

    it("handles empty input", () => {
      expect(tokenize("")).toEqual([]);
      expect(tokenize("   ")).toEqual([]);
    });

    it("extracts numbers as tokens", () => {
      const tokens = tokenize("http2Client v3");
      expect(tokens).toContain("http");
      expect(tokens).toContain("client");
    });

    it("handles code-like content", () => {
      const tokens = tokenize("public void createUser(@RequestBody UserDto dto)");
      expect(tokens).toContain("public");
      expect(tokens).toContain("void");
      expect(tokens).toContain("create");
      expect(tokens).toContain("user");
      expect(tokens).toContain("request");
      expect(tokens).toContain("body");
      expect(tokens).toContain("dto");
    });
  });

  describe("textToSparse", () => {
    it("returns parallel indices and values arrays", () => {
      const sparse = textToSparse("hello world");
      expect(sparse.indices.length).toBe(sparse.values.length);
      expect(sparse.indices.length).toBe(2);
    });

    it("counts term frequencies for repeated tokens", () => {
      const sparse = textToSparse("user user user admin");
      // "user" appears 3 times, "admin" appears 1 time
      expect(sparse.values).toContain(3);
      expect(sparse.values).toContain(1);
    });

    it("returns sorted indices", () => {
      const sparse = textToSparse("OrderServiceImpl processPayment createUser");
      for (let i = 1; i < sparse.indices.length; i++) {
        expect(sparse.indices[i]).toBeGreaterThan(sparse.indices[i - 1]);
      }
    });

    it("handles empty input", () => {
      const sparse = textToSparse("");
      expect(sparse.indices).toEqual([]);
      expect(sparse.values).toEqual([]);
    });

    it("produces deterministic output", () => {
      const a = textToSparse("processPayment in OrderService");
      const b = textToSparse("processPayment in OrderService");
      expect(a).toEqual(b);
    });
  });
});
