// middleware/csrf.ts — CSRF double-submit cookie protection.

import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";

import { env } from "../config/env.js";

const CSRF_COOKIE = "csrf-token";
const CSRF_HEADER = "X-CSRF-Token";

/** Set the csrf-token cookie on the response (non-httpOnly so JS can read it). */
export function setCsrfCookie(c: Context): void {
  setCookie(c, CSRF_COOKIE, crypto.randomUUID(), {
    httpOnly: false,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/api",
  });
}

/**
 * CSRF double-submit cookie middleware for `/api/*` routes.
 *
 * - Sets a non-httpOnly `csrf-token` cookie on every response
 * - On mutating requests (non-GET): verifies the `X-CSRF-Token` header matches the cookie
 * - Skips validation if no cookie exists yet (first request)
 */
export function csrfProtection() {
  return async (c: Context, next: Next) => {
    if (c.req.method !== "GET") {
      const cookieToken = getCookie(c, CSRF_COOKIE);

      // Skip if no cookie yet (first request before token is set)
      if (cookieToken) {
        const headerToken = c.req.header(CSRF_HEADER) ?? "";
        const match =
          cookieToken.length === headerToken.length &&
          timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
        if (!match) {
          return c.json({ error: "CSRF token mismatch" }, 403);
        }
      }
    }

    await next();

    // Set a fresh CSRF cookie on every response
    setCsrfCookie(c);
  };
}
