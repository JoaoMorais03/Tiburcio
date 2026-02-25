// indexer/bm25.ts — Simple BM25 tokenizer for Qdrant sparse vectors.
// Tokenizes text into term frequencies for client-side sparse vector generation.
// Qdrant handles IDF server-side with modifier: "idf" — we only compute TF here.

// Common English stop words — no value for code search
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "he",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "she",
  "that",
  "the",
  "to",
  "was",
  "were",
  "will",
  "with",
]);

// Split on word boundaries: whitespace, punctuation, camelCase, PascalCase, snake_case
const WORD_SPLIT_RE = /[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\b)|[a-z]+|[A-Z]+|\d+/g;

/** FNV-1a 32-bit hash — fast, good distribution, deterministic. */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

/** Tokenize text into lowercase words, splitting camelCase and filtering stop words. */
export function tokenize(text: string): string[] {
  const matches = text.match(WORD_SPLIT_RE);
  if (!matches) return [];
  return matches.map((w) => w.toLowerCase()).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** Sparse vector: parallel arrays of indices (hashed tokens) and values (term frequencies). */
export interface SparseVector {
  indices: number[];
  values: number[];
}

/** Convert text to a sparse vector of term frequencies with FNV-1a hashed indices. */
export function textToSparse(text: string): SparseVector {
  const tokens = tokenize(text);
  if (tokens.length === 0) return { indices: [], values: [] };

  // Count term frequencies
  const tf = new Map<number, number>();
  for (const token of tokens) {
    const hash = fnv1a(token);
    tf.set(hash, (tf.get(hash) ?? 0) + 1);
  }

  // Sort by index for consistent ordering (Qdrant prefers sorted indices)
  const entries = [...tf.entries()].sort((a, b) => a[0] - b[0]);
  return {
    indices: entries.map(([idx]) => idx),
    values: entries.map(([, count]) => count),
  };
}
