# Pattern: New Middleware

## Steps

1. **Create the middleware** in `backend/src/middleware/`:
   ```typescript
   // middleware/my-limiter.ts — Custom rate limiter for a specific route.

   import type { Context, Next } from "hono";

   import { env } from "../config/env.js";
   import { logger } from "../config/logger.js";
   import { redis } from "../config/redis.js";

   export async function myMiddleware(c: Context, next: Next): Promise<Response | void> {
     const key = `my-middleware:${c.req.header("x-real-ip") ?? "unknown"}`;

     const count = await redis.incr(key);
     if (count === 1) {
       await redis.expire(key, 60);
     }

     if (count > 50) {
       logger.warn({ key, count }, "Rate limit exceeded");
       return c.json({ error: "Too many requests" }, 429);
     }

     await next();
   }
   ```

2. **For standard rate limiting**, use `hono-rate-limiter` with Redis store (follows existing pattern):
   ```typescript
   import { RedisStore, rateLimiter } from "hono-rate-limiter";
   import { redis } from "../config/redis.js";

   const redisClient = {
     scriptLoad: (script: string) => redis.script("LOAD", script) as Promise<string>,
     evalsha: <TArgs extends unknown[], TData = unknown>(
       sha1: string, keys: string[], args: TArgs,
     ) => redis.evalsha(sha1, keys.length, ...keys, ...(args as string[])) as Promise<TData>,
     decr: (key: string) => redis.decr(key),
     del: (key: string) => redis.del(key),
   };

   export const myLimiter = rateLimiter({
     windowMs: 60 * 1000,
     limit: 30,
     keyGenerator: (c) => c.req.header("x-real-ip") ?? "unknown",
     store: new RedisStore({ client: redisClient, prefix: "rl:my-route:" }),
     standardHeaders: "draft-7",
   });
   ```

3. **Mount in `server.ts`** respecting the middleware order:
   ```typescript
   import { myLimiter } from "./middleware/my-limiter.js";

   // Middleware order matters:
   // 1. Logging (pinoLogger)
   // 2. Body limit
   // 3. CORS
   // 4. Security headers (secureHeaders)
   // 5. Global rate limiter
   // 6. Route-specific rate limiters  <-- mount here
   // 7. Auth (JWT cookie verification)
   // 8. Routes

   app.use("/api/my-route/*", myLimiter);
   ```

4. **Add route-specific auth middleware** if the route needs authentication:
   ```typescript
   app.use("/api/my-route/*", myLimiter);
   app.use("/api/my-route/*", cookieAuth);
   app.route("/api/my-route", myRouter);
   ```

## Conventions
- Middleware order in `server.ts` is critical: logging, body limit, CORS, security headers, global rate limiter, route-specific middleware, auth, routes
- Use Redis-backed stores for rate limiting — never use in-memory stores (they reset on restart)
- Import `env` from `config/env.js` and `logger` from `config/logger.js`
- MCP routes (`/mcp`) are mounted outside `/api/*` middleware chain — they use Bearer token auth via `TEAM_API_KEY`, not cookie auth
- Always return `{ error: string }` for error responses to match the API convention
- Use `.js` extensions in all imports (ESM)
