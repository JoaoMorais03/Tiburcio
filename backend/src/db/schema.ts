// db/schema.ts — Drizzle ORM schema: users, conversations, messages.
// Vector data (standards, code, architecture, schemas) lives in Qdrant.
// Tables are prefixed with "tb_" to avoid collisions with Langfuse in the shared database.

import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Users — authenticated accounts
// ---------------------------------------------------------------------------
export const users = pgTable(
  "tb_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    isAdmin: boolean("is_admin").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("tb_users_username_idx").on(table.username)],
);

// ---------------------------------------------------------------------------
// Conversations — chat sessions grouping related messages
// ---------------------------------------------------------------------------
export const conversations = pgTable(
  "tb_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("tb_conversations_user_id_updated_at_idx").on(table.userId, table.updatedAt)],
);

// ---------------------------------------------------------------------------
// Messages — individual chat messages within a conversation
// ---------------------------------------------------------------------------
export const messages = pgTable(
  "tb_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<"user" | "assistant">(),
    content: text("content").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("tb_messages_conversation_id_idx").on(table.conversationId)],
);
