// tools/cache.ts — Simple in-memory TTL cache for MCP tool results.
// Reduces redundant Qdrant + embedding calls within a session.

const cache = new Map<string, { result: unknown; expiry: number }>();

/** Return cached result if not expired, null otherwise. */
export function cacheGet(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

/** Store a result with a TTL in milliseconds. */
export function cacheSet(key: string, result: unknown, ttlMs: number): void {
  cache.set(key, { result, expiry: Date.now() + ttlMs });
}

/** Clear all cached entries (call after indexing jobs). */
export function cacheClear(): void {
  cache.clear();
}
