// tools/get-file-context.ts — Aggregate context bundle for a file before modifying it.
// Runs conventions, review findings, and dependency lookups in parallel.

import { logger } from "../../config/logger.js";
import { rawQdrant } from "../infra.js";
import { executeGetImpactAnalysis } from "./get-impact-analysis.js";
import { executeGetPattern } from "./get-pattern.js";
import { executeSearchStandards } from "./search-standards.js";

const REVIEWS_COLLECTION = "reviews";

/** Derive language from file extension. */
function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "java") return "java";
  if (ext === "vue") return "vue";
  if (ext === "sql") return "sql";
  return "typescript";
}

const LAYER_PATTERNS: Array<[string[], string]> = [
  [["/routes/", "/controllers/"], "controller"],
  [["/services/"], "service"],
  [["/repository/", "/repositories/"], "repository"],
  [["/stores/", "/store/"], "store"],
  [["/components/"], "component"],
  [["/pages/", "/views/"], "page"],
  [["/config/"], "config"],
  [["/model/", "/models/"], "model"],
  [["/dto/"], "dto"],
  [["/batch/"], "batch"],
  [["/composables/"], "composable"],
];

/** Derive architectural layer from path segments. */
function detectLayer(filePath: string): string {
  const lower = filePath.toLowerCase();
  for (const [patterns, layer] of LAYER_PATTERNS) {
    if (patterns.some((p) => lower.includes(p))) return layer;
  }
  return "other";
}

/** Extract base filename without extension. */
function baseName(filePath: string): string {
  const parts = filePath.split("/");
  const file = parts[parts.length - 1] ?? filePath;
  return file.replace(/\.[^.]+$/, "");
}

export type FileContextScope = "conventions" | "reviews" | "dependencies" | "all";

interface Convention {
  title: string;
  excerpt: string;
  source: string;
}

interface ReviewFinding {
  severity: string;
  text: string;
  date: string;
}

interface DependentsSummary {
  available: boolean;
  directImporters: string[];
  total: number;
}

export interface FileContextResult {
  filePath: string;
  conventions: Convention[];
  recentFindings: ReviewFinding[];
  dependents: DependentsSummary;
  applicablePatterns: string[];
  indexedAt: string | null;
  notice?: string;
}

export async function executeGetFileContext(
  filePath: string,
  scope: FileContextScope = "all",
): Promise<FileContextResult> {
  const language = detectLanguage(filePath);
  const layer = detectLayer(filePath);
  const name = baseName(filePath);

  const includeConventions = scope === "all" || scope === "conventions";
  const includeReviews = scope === "all" || scope === "reviews";
  const includeDependencies = scope === "all" || scope === "dependencies";

  // Run all lookups in parallel — each is wrapped in try/catch so one failure doesn't abort the rest
  const [conventionsResult, reviewsResult, dependentsResult, patternsResult] = await Promise.all([
    // Conventions: full mode (compact=false) for richer content
    includeConventions
      ? executeSearchStandards(`${name} ${language} ${layer} conventions`, undefined, false).catch(
          (err: unknown) => {
            logger.warn({ err, filePath }, "getFileContext: conventions lookup failed");
            return { results: [] as Array<{ title: string; content: string; category: string }> };
          },
        )
      : Promise.resolve({
          results: [] as Array<{ title: string; content: string; category: string }>,
        }),

    // Reviews: scroll Qdrant reviews collection filtered by filePath
    includeReviews
      ? rawQdrant
          .scroll(REVIEWS_COLLECTION, {
            filter: { must: [{ key: "filePath", match: { value: filePath } }] },
            limit: 10,
            with_payload: true,
          })
          .catch((err) => {
            logger.warn({ err, filePath }, "getFileContext: reviews scroll failed");
            return { points: [] };
          })
      : Promise.resolve({ points: [] }),

    // Dependents: depth 1 only for speed
    includeDependencies
      ? executeGetImpactAnalysis(filePath, "file", 1).catch((err) => {
          logger.warn({ err, filePath }, "getFileContext: impact analysis failed");
          return { available: false as const };
        })
      : Promise.resolve({ available: false as const }),

    // Patterns: list mode — returns all pattern names, we filter by relevance
    executeGetPattern(undefined).catch((err) => {
      logger.warn({ err }, "getFileContext: pattern list failed");
      return { patterns: [] as Array<{ name: string; title: string }>, found: false };
    }),
  ]);

  // Map conventions: top 2, truncate to 300 chars
  const conventions: Convention[] = (conventionsResult.results ?? [])
    .slice(0, 2)
    .map((r: { title?: string; content?: string; category?: string }) => ({
      title: r.title ?? "Untitled",
      excerpt: (r.content ?? "").slice(0, 300),
      source: r.category ?? "unknown",
    }));

  // Map reviews: sort by date desc, take last 3, extract fields
  const reviewPoints = (reviewsResult.points ?? []) as Array<{
    payload?: Record<string, unknown>;
  }>;
  const recentFindings: ReviewFinding[] = reviewPoints
    .filter((p) => p.payload?.date)
    .sort((a, b) => {
      const aDate = String(a.payload?.date ?? "");
      const bDate = String(b.payload?.date ?? "");
      return bDate.localeCompare(aDate);
    })
    .slice(0, 3)
    .map((p) => ({
      severity: String(p.payload?.severity ?? "info"),
      text: String(p.payload?.text ?? ""),
      date: String(p.payload?.date ?? ""),
    }));

  // Map dependents
  let dependents: DependentsSummary = { available: false, directImporters: [], total: 0 };
  if (dependentsResult.available === true && "dependents" in dependentsResult) {
    const deps = (
      dependentsResult as {
        available: true;
        dependents: Array<{ file: string; depth: number }>;
      }
    ).dependents;
    const directImporters = deps
      .filter((d) => d.depth === 1)
      .map((d) => d.file)
      .slice(0, 5);
    dependents = { available: true, directImporters, total: deps.length };
  }

  // Filter patterns by language/layer relevance using simple string matching
  const patternsList =
    "patterns" in patternsResult
      ? (patternsResult as { patterns: Array<{ name: string; title: string }> }).patterns
      : [];
  const applicablePatterns = patternsList
    .filter((p) => {
      const combined = `${p.name} ${p.title}`.toLowerCase();
      return (
        combined.includes(language) ||
        combined.includes(layer) ||
        combined.includes(name.toLowerCase())
      );
    })
    .map((p) => p.name)
    .slice(0, 3);

  // Extract indexedAt from review points if available
  const indexedAt = reviewPoints.length > 0 ? String(reviewPoints[0]?.payload?.date ?? null) : null;

  const result: FileContextResult = {
    filePath,
    conventions,
    recentFindings,
    dependents,
    applicablePatterns,
    indexedAt,
  };

  if (conventions.length === 0 && recentFindings.length === 0 && !dependents.available) {
    result.notice =
      "No indexed context found for this file yet. Run the indexing pipeline to populate Tiburcio's knowledge base.";
  }

  return result;
}
