// routes/auth.ts — Register, login, refresh, and logout with httpOnly cookie auth.

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { sign } from "hono/jwt";
import { z } from "zod/v4";

import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { redis } from "../config/redis.js";
import { db } from "../db/connection.js";
import { users } from "../db/schema.js";

const authRouter = new Hono();

const TOKEN_EXPIRY = 60 * 60; // 1 hour
const REFRESH_EXPIRY = 60 * 60 * 24 * 7; // 7 days

// Dummy hash for timing-safe comparison when user doesn't exist
const DUMMY_HASH = await bcrypt.hash("dummy-password-for-timing-safety", 10);

const authBody = z.object({
  username: z
    .string()
    .min(2, "Username must be at least 2 characters")
    .transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/** Set httpOnly access + refresh cookies. */
async function issueTokens(c: Context, userId: string, username: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();

  const accessToken = await sign(
    { sub: userId, username, exp: now + TOKEN_EXPIRY },
    env.JWT_SECRET,
    "HS256",
  );

  const refreshToken = await sign(
    { sub: userId, username, jti, exp: now + REFRESH_EXPIRY },
    env.JWT_SECRET,
    "HS256",
  );

  // Store refresh token jti in Redis for revocation
  await redis.set(`refresh:${jti}`, userId, "EX", REFRESH_EXPIRY);

  const cookieBase = {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax" as const,
    path: "/api",
  };

  setCookie(c, "token", accessToken, { ...cookieBase, maxAge: TOKEN_EXPIRY });
  setCookie(c, "refresh_token", refreshToken, {
    ...cookieBase,
    maxAge: REFRESH_EXPIRY,
  });
}

authRouter.post("/register", async (c) => {
  const parsed = authBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const { username, password } = parsed.data;

  const existing = await db.query.users.findFirst({
    where: eq(users.username, username),
  });

  if (existing) {
    return c.json({ error: "Registration failed" }, 400);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(users).values({ username, passwordHash }).returning();

  await issueTokens(c, user.id, user.username);

  logger.info({ username: user.username }, "User registered");
  return c.json({ user: { id: user.id, username: user.username } });
});

authRouter.post("/login", async (c) => {
  const parsed = authBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const { username, password } = parsed.data;

  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  });

  // Always run bcrypt.compare to prevent timing-based user enumeration
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !valid) {
    logger.warn({ username }, "Failed login attempt");
    return c.json({ error: "Invalid credentials" }, 401);
  }

  await issueTokens(c, user.id, user.username);

  logger.info({ username: user.username }, "User logged in");
  return c.json({ user: { id: user.id, username: user.username } });
});

authRouter.post("/refresh", async (c) => {
  const { verify } = await import("hono/jwt");
  const refreshCookie = await import("hono/cookie").then((m) => m.getCookie(c, "refresh_token"));

  if (!refreshCookie) {
    return c.json({ error: "No refresh token" }, 401);
  }

  try {
    const payload = await verify(refreshCookie, env.JWT_SECRET, "HS256");
    const jti = payload.jti as string | undefined;

    if (!jti) {
      return c.json({ error: "Invalid refresh token" }, 401);
    }

    // Check jti exists in Redis (not revoked)
    const stored = await redis.get(`refresh:${jti}`);
    if (!stored) {
      return c.json({ error: "Refresh token revoked" }, 401);
    }

    // Rotate: delete old jti, issue new pair
    await redis.del(`refresh:${jti}`);
    await issueTokens(c, payload.sub as string, payload.username as string);

    return c.json({ user: { id: payload.sub, username: payload.username } });
  } catch {
    return c.json({ error: "Invalid refresh token" }, 401);
  }
});

authRouter.post("/logout", async (c) => {
  const { verify } = await import("hono/jwt");
  const refreshCookie = await import("hono/cookie").then((m) => m.getCookie(c, "refresh_token"));

  // Revoke refresh token if present
  if (refreshCookie) {
    try {
      const payload = await verify(refreshCookie, env.JWT_SECRET, "HS256");
      if (payload.jti) {
        await redis.del(`refresh:${payload.jti as string}`);
      }
    } catch {
      // Token already expired or invalid — just clear cookies
    }
  }

  const cookieBase = { httpOnly: true, path: "/api" };
  deleteCookie(c, "token", cookieBase);
  deleteCookie(c, "refresh_token", cookieBase);

  return c.json({ message: "Logged out" });
});

export default authRouter;
