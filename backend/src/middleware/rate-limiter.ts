// middleware/rate-limiter.ts — Redis-backed rate limiters.

import type { Context } from "hono";
import { RedisStore, rateLimiter } from "hono-rate-limiter";

import { env } from "../config/env.js";
import { redis } from "../config/redis.js";

const redisClient = {
  scriptLoad: (script: string) => redis.script("LOAD", script) as Promise<string>,
  evalsha: <TArgs extends unknown[], TData = unknown>(sha1: string, keys: string[], args: TArgs) =>
    redis.evalsha(sha1, keys.length, ...keys, ...(args as string[])) as Promise<TData>,
  decr: (key: string) => redis.decr(key),
  del: (key: string) => redis.del(key),
};

/**
 * Extract client IP safely. Only trust x-forwarded-for in production behind a
 * known reverse proxy. In development, fall back to the raw connection address.
 */
function clientIp(c: Context): string {
  if (env.NODE_ENV === "production") {
    // In production behind a trusted proxy: take the *last* entry from
    // x-forwarded-for (closest proxy-added value) to prevent spoofing.
    const xff = c.req.header("x-forwarded-for");
    if (xff) {
      const parts = xff
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return parts[parts.length - 1] ?? "unknown";
    }
  }
  // Fallback: direct connection IP from the request (not spoofable)
  return c.req.header("x-real-ip") ?? c.env?.remoteAddr ?? "unknown";
}

export const globalLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 100,
  keyGenerator: (c) => clientIp(c),
  store: new RedisStore({ client: redisClient, prefix: "rl:global:" }),
  standardHeaders: "draft-7",
});

export const authLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (c) => clientIp(c),
  store: new RedisStore({ client: redisClient, prefix: "rl:auth:" }),
  standardHeaders: "draft-7",
});

export const chatLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (c) => {
    const payload = c.get("jwtPayload");
    return payload?.sub ?? "anonymous";
  },
  store: new RedisStore({ client: redisClient, prefix: "rl:chat:" }),
  standardHeaders: "draft-7",
});
