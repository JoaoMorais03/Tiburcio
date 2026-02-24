// db/migrate.ts — Runs Drizzle migrations from the generated ./drizzle folder.
// Schema is defined once in schema.ts; migrations are generated via `pnpm db:generate`.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { logger } from "../config/logger.js";
import { db } from "./connection.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, "..", "..", "drizzle");

export async function runMigrations(): Promise<void> {
  logger.info("Running database migrations...");
  try {
    await migrate(db, { migrationsFolder });
    logger.info("Database migrations completed");
  } catch (error) {
    logger.error({ error }, "Migration failed");
    throw error;
  }
}

const isDirectRun =
  process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js");

if (isDirectRun) {
  runMigrations()
    .then(() => {
      logger.info("Migrations complete");
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, "Migration error");
      process.exit(1);
    });
}
