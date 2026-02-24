// config/logger.ts — Pino structured logger (JSON in prod, pretty in dev).

import pino from "pino";

import { env } from "./env.js";

const isDev = env.NODE_ENV === "development";

export const logger = pino({
  level: isDev ? "debug" : "info",
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  }),
});
