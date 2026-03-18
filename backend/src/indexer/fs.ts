// indexer/fs.ts — Shared filesystem utilities for indexers.

import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import { logger } from "../config/logger.js";

/** Directories to skip during source file discovery. */
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "target",
  "build",
  "dist",
  ".idea",
  ".mvn",
  ".vscode",
  ".claude",
  "cicd",
  "docs",
  "test",
  "__tests__",
  "cypress",
]);

/** File extensions recognized as indexable source code. */
export const SOURCE_EXTENSIONS = new Set([".java", ".vue", ".ts", ".tsx", ".sql"]);

/** Filename patterns that may contain secrets — blocked from indexing. */
export const BLOCKED_FILE_PATTERNS = [
  /\.config\.(ts|js|mjs|cjs)$/,
  /\.env(\..+)?$/,
  /docker-compose.*\.ya?ml$/,
  /Dockerfile/,
  /secrets?\.(ts|js|json|ya?ml)$/,
  /credentials?\.(ts|js|json)$/,
];

/** Path segments that indicate risky directories — blocked from indexing. */
export const BLOCKED_PATH_SEGMENTS = new Set([
  "resources",
  "environments",
  "env",
  "config",
  ".github",
  ".gitlab",
  "terraform",
  "helm",
  "k8s",
  "kubernetes",
  "ansible",
]);

/** Check whether a file should be blocked based on filename or path segments. */
export function isFileBlocked(filename: string, relativePath: string): boolean {
  if (BLOCKED_FILE_PATTERNS.some((pattern) => pattern.test(filename))) return true;
  return relativePath.split("/").some((part) => BLOCKED_PATH_SEGMENTS.has(part));
}

/** Load .tibignore glob patterns from a repo root, converting them to RegExp. */
export async function loadTibignorePatterns(codebasePath: string): Promise<RegExp[]> {
  try {
    const tibignorePath = join(codebasePath, ".tibignore");
    const content = await readFile(tibignorePath, "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((pattern) => {
        // Convert simple glob patterns to regex
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        const regex = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
        return new RegExp(`^${regex}$`);
      });
  } catch {
    return [];
  }
}

export interface FindSourceFilesOptions {
  /** When true, apply isFileBlocked checks (default: false). */
  checkBlocked?: boolean;
  /** When true, return paths relative to codebasePath (default: false = full paths). */
  relativePaths?: boolean;
}

function isIgnored(relPath: string, tibignorePatterns: RegExp[]): boolean {
  if (!tibignorePatterns.some((pattern) => pattern.test(relPath))) return false;
  logger.debug({ path: relPath }, "Skipped by .tibignore");
  return true;
}

function shouldIncludeFile(name: string, relPath: string, checkBlocked: boolean): boolean {
  if (!SOURCE_EXTENSIONS.has(extname(name))) return false;
  if (checkBlocked && isFileBlocked(name, relPath)) {
    logger.debug({ path: relPath }, "Skipped blocked file");
    return false;
  }
  return true;
}

function entryPath(fullPath: string, relPath: string, relativePaths: boolean): string {
  return relativePaths ? relPath : fullPath;
}

/**
 * Recursively find source files under a directory, respecting SKIP_DIRS,
 * SOURCE_EXTENSIONS, .tibignore patterns, and optionally blocked-file checks.
 */
export async function findSourceFiles(
  dir: string,
  codebasePath: string,
  tibignorePatterns: RegExp[],
  options: FindSourceFilesOptions = {},
): Promise<string[]> {
  const checkBlocked = options.checkBlocked ?? false;
  const relativePaths = options.relativePaths ?? false;
  const files: string[] = [];
  let entries: import("node:fs").Dirent[] | undefined;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    const relPath = relative(codebasePath, fullPath);

    if (isIgnored(relPath, tibignorePatterns)) continue;

    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      files.push(...(await findSourceFiles(fullPath, codebasePath, tibignorePatterns, options)));
    } else if (entry.isFile() && shouldIncludeFile(entry.name, relPath, checkBlocked)) {
      files.push(entryPath(fullPath, relPath, relativePaths));
    }
  }
  return files;
}

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
