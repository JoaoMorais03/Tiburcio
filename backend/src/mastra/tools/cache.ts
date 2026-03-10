// tools/cache.ts — Simple in-memory TTL cache for MCP tool results.
// Reduces redundant Qdrant + embedding calls within a session.
// Max 500 entries with FIFO eviction to prevent unbounded growth.

const MAX_ENTRIES = 500;
const cache = new Map<string, { result: unknown; expiry: number }>();

/** Return cached result if not expired, null otherwise. */
export function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  return entry.result as T;
}

/** Store a result with a TTL in milliseconds. Evicts oldest entry when at capacity. */
export function cacheSet(key: string, result: unknown, ttlMs: number): void {
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    // FIFO eviction: delete the first (oldest) inserted key
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { result, expiry: Date.now() + ttlMs });
}

/** Clear all cached entries (call after indexing jobs). */
export function cacheClear(): void {
  cache.clear();
}
