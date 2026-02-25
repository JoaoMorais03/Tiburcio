// tools/truncate.ts — Cap large text fields to reduce Claude Code token processing overhead.

const DEFAULT_MAX = 1500;
const SUFFIX = "\n… (truncated)";

export function truncate(text: string, max = DEFAULT_MAX): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + SUFFIX;
}
