// config/redis.ts — Shared ioredis client (rate limiter).

import Redis from "ioredis";

import { env } from "./env.js";
import { logger } from "./logger.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
});

redis.on("error", (err) => {
  logger.error({ err: err.message }, "Redis connection error");
});

redis.on("connect", () => {
  logger.info("Redis connected");
});

redis.on("reconnecting", () => {
  logger.warn("Redis reconnecting");
});
