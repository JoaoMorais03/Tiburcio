// indexer/fs.ts — Shared filesystem utilities for indexers.

import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Recursively find all .md files under a directory. */
export async function findMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  let entries: import("node:fs").Dirent[] | undefined;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findMarkdownFiles(fullPath)));
    } else if (entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}
