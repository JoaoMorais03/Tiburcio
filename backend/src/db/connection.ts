// db/connection.ts — Drizzle ORM database instance (postgres.js driver).

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../config/env.js";
import * as schema from "./schema.js";

export const connection = postgres(env.DATABASE_URL);
export const db = drizzle(connection, { schema });
