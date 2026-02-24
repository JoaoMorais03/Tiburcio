// helpers/conversation.ts — Conversation resolution (find existing or create new).

import { and, eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { conversations } from "../db/schema.js";

export async function resolveConversation(
  userId: string,
  conversationId: string | undefined,
  firstMessage: string,
): Promise<string> {
  if (conversationId) {
    const conv = await db.query.conversations.findFirst({
      where: and(eq(conversations.id, conversationId), eq(conversations.userId, userId)),
    });
    if (!conv) throw new Error("Conversation not found");
    return conv.id;
  }

  const title = firstMessage.slice(0, 50);
  const [conv] = await db.insert(conversations).values({ title, userId }).returning();
  return conv.id;
}
