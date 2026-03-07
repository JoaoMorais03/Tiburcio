// graph/client.ts — Neo4j driver with lazy init and graceful degradation.
// If NEO4J_URI is not set, isGraphAvailable() returns false and no driver is created.
// Everything else in the codebase checks isGraphAvailable() before calling graph functions.

import neo4j, { type Driver, type Session } from "neo4j-driver";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

let _driver: Driver | null = null;

export function isGraphAvailable(): boolean {
  return !!env.NEO4J_URI;
}

export function getGraphDriver(): Driver {
  if (!isGraphAvailable()) {
    throw new Error("Neo4j not configured. Set NEO4J_URI to enable graph features.");
  }
  if (!_driver) {
    _driver = neo4j.driver(
      env.NEO4J_URI as string,
      neo4j.auth.basic("neo4j", env.NEO4J_PASSWORD as string),
      {
        logging: {
          level: "warn",
          logger: (_level: string, msg: string) => logger.debug({ msg }, "neo4j"),
        },
      },
    );
    logger.info({ uri: env.NEO4J_URI }, "Neo4j driver initialized");
  }
  return _driver;
}

export async function closeGraphDriver(): Promise<void> {
  if (_driver) {
    await _driver.close();
    _driver = null;
    logger.info("Neo4j driver closed");
  }
}

/** Run a Cypher query in a new session, auto-close session after. */
export async function runCypher<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const driver = getGraphDriver();
  const session: Session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

/** Ensure schema constraints and indexes exist (idempotent, no-op if graph unavailable). */
export async function ensureGraphSchema(): Promise<void> {
  if (!isGraphAvailable()) return;
  const statements = [
    "CREATE CONSTRAINT file_id IF NOT EXISTS FOR (f:File) REQUIRE f.id IS UNIQUE",
    "CREATE CONSTRAINT function_id IF NOT EXISTS FOR (fn:Function) REQUIRE fn.id IS UNIQUE",
    "CREATE CONSTRAINT class_id IF NOT EXISTS FOR (c:Class) REQUIRE c.id IS UNIQUE",
    "CREATE CONSTRAINT table_id IF NOT EXISTS FOR (t:Table) REQUIRE t.id IS UNIQUE",
    "CREATE INDEX file_repo IF NOT EXISTS FOR (f:File) ON (f.repo)",
  ];
  for (const cypher of statements) {
    await runCypher(cypher).catch(() => {});
  }
  logger.info("Neo4j schema constraints ensured");
}
