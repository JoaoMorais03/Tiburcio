# Pattern: New Drizzle Migration

## Steps

1. **Edit the schema** in `backend/src/db/schema.ts` using Drizzle's `pgTable`:
   ```typescript
   import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

   export const items = pgTable("items", {
     id: uuid("id").defaultRandom().primaryKey(),
     name: text("name").notNull(),
     description: text("description"),
     userId: uuid("user_id")
       .notNull()
       .references(() => users.id, { onDelete: "cascade" }),
     createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
     updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
   });
   ```

2. **Generate the migration** — never write raw DDL:
   ```bash
   cd backend && pnpm db:generate
   ```

3. **Review the generated SQL** in `backend/drizzle/`. Drizzle auto-generates the migration file with the correct SQL:
   ```bash
   ls backend/drizzle/
   # 0000_initial.sql  0001_add_items.sql  meta/
   ```

4. **Run the migration** against your database:
   ```bash
   cd backend && pnpm db:migrate
   ```

5. **Use the table** in route handlers or services via the Drizzle query builder:
   ```typescript
   import { db } from "../db/connection.js";
   import { items } from "../db/schema.js";
   import { eq } from "drizzle-orm";

   const userItems = await db
     .select()
     .from(items)
     .where(eq(items.userId, userId));
   ```

6. **Add indexes** for frequently queried columns:
   ```typescript
   import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";

   export const items = pgTable(
     "items",
     {
       id: uuid("id").defaultRandom().primaryKey(),
       userId: uuid("user_id").notNull(),
       name: text("name").notNull(),
     },
     (table) => [index("items_user_id_idx").on(table.userId)],
   );
   ```

## Conventions
- Schema is the single source of truth — always edit `db/schema.ts` first, then generate
- Never write raw DDL or hand-edit migration files
- Use Drizzle query builder in application code — avoid raw SQL unless needed for vector operations
- Always add `createdAt` and `updatedAt` timestamps with timezone to new tables
- Use `uuid` primary keys with `defaultRandom()`
- Foreign keys should specify `onDelete` behavior explicitly
- Run `pnpm db:generate` after every schema change, then `pnpm db:migrate` to apply
