// routes/chat.ts — Chat endpoints (SSE streaming + conversation management).

import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { JwtVariables } from "hono/jwt";
import { streamSSE } from "hono/streaming";
import { z } from "zod/v4";

import { logger } from "../config/logger.js";
import { db } from "../db/connection.js";
import { conversations, messages } from "../db/schema.js";
import { resolveConversation } from "../helpers/conversation.js";
import { chatAgent } from "../mastra/agents/chat-agent.js";

const MAX_RESPONSE_SIZE = 100_000; // 100KB max accumulated response

const chatRouter = new Hono<{ Variables: JwtVariables }>();

const chatBody = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1, "Message cannot be empty").max(10000, "Message too long"),
});

chatRouter.post("/stream", async (c) => {
  const { sub: userId } = c.get("jwtPayload");

  const parsed = chatBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const { conversationId: reqConvId, message } = parsed.data;

  let conversationId: string;
  try {
    conversationId = await resolveConversation(userId, reqConvId, message);
  } catch {
    return c.json({ error: "Conversation not found" }, 404);
  }

  await db.insert(messages).values({ conversationId, role: "user", content: message });
  await db
    .update(conversations)
    .set({ updatedAt: sql`NOW()` })
    .where(eq(conversations.id, conversationId));

  return streamSSE(c, async (sseStream) => {
    await sseStream.writeSSE({
      event: "conversation",
      data: JSON.stringify({ conversationId }),
    });

    const aborted = () => c.req.raw.signal.aborted;

    try {
      const stream = await chatAgent.stream(message, {
        memory: { thread: conversationId, resource: userId },
      });
      let fullResponse = "";

      for await (const chunk of stream.textStream) {
        if (aborted()) {
          logger.info({ conversationId }, "SSE stream aborted by client");
          return;
        }
        fullResponse += chunk;
        if (fullResponse.length > MAX_RESPONSE_SIZE) {
          logger.warn(
            { conversationId, size: fullResponse.length },
            "Response size limit reached, truncating",
          );
          break;
        }
        await sseStream.writeSSE({
          event: "token",
          data: JSON.stringify({ token: chunk }),
        });
      }

      if (aborted()) return;

      const [assistantMsg] = await db
        .insert(messages)
        .values({ conversationId, role: "assistant", content: fullResponse })
        .returning();

      await sseStream.writeSSE({
        event: "done",
        data: JSON.stringify({ messageId: assistantMsg.id, conversationId }),
      });
    } catch (error) {
      if (aborted()) return;
      logger.error({ error, conversationId }, "Agent streaming error");
      await sseStream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: "Failed to generate response" }),
      });
    }
  });
});

chatRouter.get("/conversations", async (c) => {
  const { sub: userId } = c.get("jwtPayload");
  const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10) || 50, 100);
  const offset = Math.max(Number.parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  const result = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit)
    .offset(offset);

  return c.json(result);
});

chatRouter.get("/conversations/:id/messages", async (c) => {
  const { sub: userId } = c.get("jwtPayload");
  const { id } = c.req.param();
  const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "100", 10) || 100, 200);
  const offset = Math.max(Number.parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.id, id), eq(conversations.userId, userId)),
  });

  if (!conv) return c.json({ error: "Conversation not found" }, 404);

  const result = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt)
    .limit(limit)
    .offset(offset);

  return c.json(result);
});

chatRouter.delete("/conversations/:id", async (c) => {
  const { sub: userId } = c.get("jwtPayload");
  const { id } = c.req.param();

  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.id, id), eq(conversations.userId, userId)),
  });

  if (!conv) return c.json({ error: "Conversation not found" }, 404);

  await db.delete(conversations).where(eq(conversations.id, id));
  return c.json({ message: "Conversation deleted" });
});

export default chatRouter;
