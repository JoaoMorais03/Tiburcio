// tools/get-pattern.ts — File lookup for named code templates.

import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";

const PATTERNS_DIR = resolve(import.meta.dirname, "..", "..", "..", "..", "standards", "patterns");
const SAFE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export const getPattern = createTool({
  id: "getPattern",
  mcp: {
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  description:
    "Get a named code template/pattern or list all available patterns. " +
    "If name is omitted, returns a list of all available patterns with summaries. " +
    "Common patterns: new-api-endpoint, new-batch-job, new-vue-page. " +
    "For how conventions work, use searchStandards. For real code examples, use searchCode.",
  inputSchema: z.object({
    name: z
      .string()
      .optional()
      .describe("Pattern name without extension, e.g. 'new-batch-job'. Omit to list all."),
  }),

  execute: async (inputData) => {
    const { name } = inputData;

    // List mode: return all available patterns with first-line summaries
    if (!name) {
      try {
        const files = await readdir(PATTERNS_DIR);
        const patterns = await Promise.all(
          files
            .filter((f) => f.endsWith(".md"))
            .map(async (f) => {
              const content = await readFile(join(PATTERNS_DIR, f), "utf-8");
              const firstHeading = content.match(/^#\s+(.+)$/m);
              return {
                name: basename(f, ".md"),
                title: firstHeading ? firstHeading[1].trim() : basename(f, ".md"),
              };
            }),
        );
        return { patterns, found: true, mode: "list" };
      } catch {
        return {
          patterns: [],
          found: false,
          message: "Patterns directory not found.",
        };
      }
    }

    // Lookup mode: validate name to prevent path traversal
    if (!SAFE_NAME_RE.test(name)) {
      return {
        name,
        found: false,
        message: "Invalid pattern name. Use lowercase alphanumeric and hyphens only.",
      };
    }
    const filePath = resolve(PATTERNS_DIR, `${name}.md`);
    if (!filePath.startsWith(PATTERNS_DIR)) {
      return { name, found: false, message: "Invalid pattern name." };
    }

    try {
      const content = await readFile(filePath, "utf-8");
      return { name, content, found: true, mode: "detail" };
    } catch {
      try {
        const files = await readdir(PATTERNS_DIR);
        const available = files.filter((f) => f.endsWith(".md")).map((f) => basename(f, ".md"));
        return {
          name,
          found: false,
          message: `Pattern '${name}' not found.`,
          availablePatterns: available,
        };
      } catch {
        return {
          name,
          found: false,
          message: "Patterns directory not found.",
          availablePatterns: [],
        };
      }
    }
  },
});
