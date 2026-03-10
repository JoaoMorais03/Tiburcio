// mastra/tools/detect.ts — Shared language and architectural layer detection.
// Single source of truth used by get-file-context and validate-code.

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

/** Derive language from file extension. */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "java") return "java";
  if (ext === "vue") return "vue";
  if (ext === "sql") return "sql";
  return "typescript";
}

/** Derive architectural layer from path segments. */
export function detectLayer(filePath: string): string {
  const lower = filePath.toLowerCase();
  for (const [patterns, layer] of LAYER_PATTERNS) {
    if (patterns.some((p) => lower.includes(p))) return layer;
  }
  return "other";
}
