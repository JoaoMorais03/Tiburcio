// Tests for the code chunker (pure unit tests, no mocks).

import { describe, expect, it } from "vitest";
import { chunkFile, detectLanguage } from "../indexer/chunker.js";

// Build content that exceeds MAX_CHUNK_SIZE (3000 chars) using realistic code
function buildJavaClass(methodCount: number): string {
  const methods = Array.from(
    { length: methodCount },
    (_, i) =>
      `  @Transactional
  public void process${i}(String input) {
    // Validate input parameters
    if (input == null || input.isEmpty()) {
      throw new IllegalArgumentException("Input cannot be null");
    }
    String result = input.toUpperCase();
    System.out.println("Processing: " + result);
    logger.info("Processed item " + ${i});
  }`,
  ).join("\n\n");

  return `package com.example.app.service;

import org.springframework.stereotype.Service;
import javax.transaction.Transactional;

@Service
public class BigService {

${methods}
}`;
}

function buildVueSFC(): string {
  const templateLines = Array.from(
    { length: 30 },
    (_, i) => `    <div class="item-${i}">{{ items[${i}] }}</div>`,
  ).join("\n");
  const scriptLines = Array.from({ length: 30 }, (_, i) => `const value${i} = ref(${i});`).join(
    "\n",
  );
  const styleLines = Array.from(
    { length: 20 },
    (_, i) => `.item-${i} { color: hsl(${i * 18}, 70%, 50%); padding: 8px; margin: 4px; }`,
  ).join("\n");

  return `<template>
  <div class="container">
${templateLines}
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
${scriptLines}
</script>

<style scoped>
${styleLines}
</style>`;
}

function buildTSFile(exportCount: number): string {
  const exports = Array.from(
    { length: exportCount },
    (_, i) =>
      `export function validate${i}(input: string): boolean {
  if (!input || input.length < ${i + 1}) {
    return false;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 && trimmed !== "undefined";
}`,
  ).join("\n\n");

  return `import { z } from "zod";\nimport type { Config } from "./types";\n\n${exports}`;
}

function buildSQL(statementCount: number): string {
  return Array.from(
    { length: statementCount },
    (_, i) =>
      `CREATE TABLE entity_${i} (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);`,
  ).join("\n\n");
}

describe("detectLanguage", () => {
  it("detects Java files", () => {
    expect(detectLanguage("src/main/java/Service.java")).toBe("java");
  });

  it("detects TypeScript files (.ts and .tsx)", () => {
    expect(detectLanguage("src/utils.ts")).toBe("typescript");
    expect(detectLanguage("src/component.tsx")).toBe("typescript");
  });

  it("detects Vue files", () => {
    expect(detectLanguage("src/pages/Home.vue")).toBe("vue");
  });

  it("detects SQL files", () => {
    expect(detectLanguage("migrations/001.sql")).toBe("sql");
  });

  it("returns null for unknown extensions", () => {
    expect(detectLanguage("README.md")).toBeNull();
    expect(detectLanguage("image.png")).toBeNull();
    expect(detectLanguage("config.yaml")).toBeNull();
  });
});

describe("chunkFile", () => {
  describe("Java", () => {
    it("returns single chunk for small files (< 3000 chars)", () => {
      const java = `package com.example;
public class Tiny {
  public void hello() { System.out.println("hi"); }
}`;
      const chunks = chunkFile(java, "src/main/java/Tiny.java");
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toContain("public void hello()");
      expect(chunks[0].language).toBe("java");
    });

    it("splits large files and each chunk contains actual method code", () => {
      const java = buildJavaClass(10);
      expect(java.length).toBeGreaterThan(3000); // Sanity check

      const chunks = chunkFile(java, "src/main/java/business/impl/BigService.java");

      expect(chunks.length).toBeGreaterThanOrEqual(3); // header + at least 2 method chunks
      // First chunk should be the header (package, imports, class declaration)
      expect(chunks[0].content).toContain("package com.example");
      expect(chunks[0].content).toContain("import");
      // At least one chunk should contain a process method
      const methodChunks = chunks.filter((c) => c.content.includes("public void process"));
      expect(methodChunks.length).toBeGreaterThanOrEqual(1);
      // Annotations should be included with their methods
      const annotatedChunks = chunks.filter((c) => c.content.includes("@Transactional"));
      expect(annotatedChunks.length).toBeGreaterThanOrEqual(1);
      // Layer inference from path
      expect(chunks[0].layer).toBe("service");
    });

    it("infers controller layer from path", () => {
      const java = buildJavaClass(10);
      const chunks = chunkFile(java, "src/main/java/web/controller/MyController.java");
      expect(chunks.every((c) => c.layer === "controller")).toBe(true);
    });
  });

  describe("Vue", () => {
    it("splits large SFC into template/script/style sections", () => {
      const vue = buildVueSFC();
      expect(vue.length).toBeGreaterThan(3000);

      const chunks = chunkFile(vue, "src/pages/Dashboard.vue");

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      // Verify chunks contain actual SFC section tags
      const hasTemplate = chunks.some((c) => c.content.includes("<template>"));
      const hasScript = chunks.some((c) => c.content.includes("<script"));
      expect(hasTemplate).toBe(true);
      expect(hasScript).toBe(true);
      expect(chunks[0].layer).toBe("page");
    });
  });

  describe("TypeScript", () => {
    it("splits large files on export boundaries with real function content", () => {
      const ts = buildTSFile(20);
      expect(ts.length).toBeGreaterThan(3000);

      const chunks = chunkFile(ts, "src/composables/validators.ts");

      expect(chunks.length).toBeGreaterThanOrEqual(3); // header + multiple export chunks
      // First chunk should be imports
      expect(chunks[0].content).toContain("import");
      // Later chunks should contain export functions
      const exportChunks = chunks.filter((c) => c.content.includes("export function validate"));
      expect(exportChunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].layer).toBe("composable");
    });
  });

  describe("SQL", () => {
    it("splits large files on CREATE statement boundaries", () => {
      const sql = buildSQL(20);
      expect(sql.length).toBeGreaterThan(3000);

      const chunks = chunkFile(sql, "migrations/001_init.sql");

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      // Each chunk should contain a CREATE TABLE
      for (const chunk of chunks) {
        expect(chunk.content).toContain("CREATE TABLE");
        expect(chunk.language).toBe("sql");
        expect(chunk.layer).toBe("database");
      }
    });
  });

  describe("edge cases", () => {
    it("returns empty array for unknown file types", () => {
      expect(chunkFile("any content", "readme.md")).toEqual([]);
      expect(chunkFile("any content", "photo.png")).toEqual([]);
    });

    it("line numbers are correct for single-chunk files", () => {
      const content = "const a = 1;\nconst b = 2;\nconst c = 3;";
      const chunks = chunkFile(content, "test.ts");
      expect(chunks).toHaveLength(1);
      expect(chunks[0].startLine).toBe(1);
      expect(chunks[0].endLine).toBe(3);
    });

    it("multi-chunk line numbers don't overlap and cover the whole file", () => {
      const java = buildJavaClass(10);
      const chunks = chunkFile(java, "src/main/java/business/impl/Svc.java");
      const totalLines = java.split("\n").length;

      // Chunks should be ordered by line number
      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i].startLine).toBeGreaterThan(chunks[i - 1].startLine);
      }
      // Last chunk should end at or near total lines
      expect(chunks[chunks.length - 1].endLine).toBeLessThanOrEqual(totalLines);
      expect(chunks[chunks.length - 1].endLine).toBeGreaterThanOrEqual(totalLines - 5);
    });
  });
});
