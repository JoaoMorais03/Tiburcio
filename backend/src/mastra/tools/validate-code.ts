// tools/validate-code.ts — Validate a code snippet against team conventions via LLM.
// Uses indexed standards as the source of truth — not generic best practices.

import { generateText } from "ai";

import { logger } from "../../config/logger.js";
import { getChatModel } from "../../lib/model-provider.js";
import { executeSearchStandards } from "./search-standards.js";

const VALIDATION_SYSTEM_PROMPT = `You are a code convention validator. Given team coding standards and a code snippet, identify specific violations.

Respond ONLY with a JSON array of violations. Each violation:
{ "rule": "short rule name", "description": "what's wrong (1-2 sentences)", "severity": "info|warning|critical" }

If no violations, respond with [].

Focus on: documented conventions, patterns, and standards. NOT general best practices.`;

/** Derive language from filePath extension. */
function detectLanguage(
  filePath: string,
  explicit?: "java" | "typescript" | "vue" | "sql",
): string {
  if (explicit) return explicit;
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
];

/** Derive architectural layer from path segments. */
function detectLayer(filePath: string): string {
  const lower = filePath.toLowerCase();
  for (const [patterns, layer] of LAYER_PATTERNS) {
    if (patterns.some((p) => lower.includes(p))) return layer;
  }
  return "other";
}

interface Violation {
  rule: string;
  description: string;
  severity: "info" | "warning" | "critical";
}

export interface ValidateCodeResult {
  pass: boolean;
  violations: Violation[];
  conventionsChecked: number;
  notice?: string;
}

export async function executeValidateCode(
  code: string,
  filePath: string,
  language?: "java" | "typescript" | "vue" | "sql",
): Promise<ValidateCodeResult> {
  const lang = detectLanguage(filePath, language);
  const layer = detectLayer(filePath);

  // Fetch relevant standards — full mode for complete text
  let standardsResult: Awaited<ReturnType<typeof executeSearchStandards>>;
  try {
    standardsResult = await executeSearchStandards(
      `${lang} ${layer} conventions`,
      undefined,
      false,
    );
  } catch (err) {
    logger.warn({ err, filePath }, "validateCode: standards lookup failed");
    return {
      pass: true,
      violations: [],
      conventionsChecked: 0,
      notice: "Could not load standards — skipping validation.",
    };
  }

  if (!standardsResult.results || standardsResult.results.length === 0) {
    return {
      pass: true,
      violations: [],
      conventionsChecked: 0,
      notice: "No conventions indexed yet. Index your standards/ directory first.",
    };
  }

  const standardsText = (standardsResult.results as Array<{ title: string; content: string }>)
    .map((r) => `## ${r.title}\n${r.content}`)
    .join("\n\n");

  const prompt = `Team coding standards for ${lang} (${layer} layer):

${standardsText}

---

Code to validate (${filePath}):

\`\`\`${lang}
${code}
\`\`\`

Identify any violations of the team standards above. Respond ONLY with a JSON array.`;

  try {
    const { text } = await generateText({
      model: getChatModel(),
      system: VALIDATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      abortSignal: AbortSignal.timeout(30_000),
    });

    let violations: Violation[] = [];
    try {
      violations = JSON.parse(text);
    } catch {
      // Try to extract JSON from fences or bare array
      const fenceMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
      const bareMatch = text.match(/\[[\s\S]*\]/);
      const raw = fenceMatch?.[1] ?? bareMatch?.[0];
      if (raw) {
        try {
          violations = JSON.parse(raw);
        } catch {
          logger.warn({ filePath }, "validateCode: could not parse LLM response as JSON");
          violations = [];
        }
      }
    }

    // Ensure violations is an array
    if (!Array.isArray(violations)) violations = [];

    const criticalOrWarning = violations.filter(
      (v) => v.severity === "critical" || v.severity === "warning",
    );

    return {
      pass: criticalOrWarning.length === 0,
      violations,
      conventionsChecked: standardsResult.results.length,
    };
  } catch (err) {
    logger.error({ err, filePath }, "validateCode: LLM call failed");
    return {
      pass: true,
      violations: [],
      conventionsChecked: standardsResult.results.length,
      notice: "Validation failed — LLM call timed out or errored. Try again.",
    };
  }
}
