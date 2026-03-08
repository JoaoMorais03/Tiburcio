// routes/chat.ts — Chat endpoints (SSE streaming + conversation management).

import { stepCountIs, streamText } from "ai";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { JwtVariables } from "hono/jwt";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { logger } from "../config/logger.js";
import { db } from "../db/connection.js";
import { conversations, messages } from "../db/schema.js";
import { resolveConversation } from "../helpers/conversation.js";
import { getLangfuse } from "../lib/langfuse.js";
import { getChatModel } from "../lib/model-provider.js";
import { getArchitectureTool } from "../mastra/tools/get-architecture.js";
import { getChangeSummaryTool } from "../mastra/tools/get-change-summary.js";
import { getNightlySummaryTool } from "../mastra/tools/get-nightly-summary.js";
import { getPatternTool } from "../mastra/tools/get-pattern.js";
import { getTestSuggestionsTool } from "../mastra/tools/get-test-suggestions.js";
import { searchCodeTool } from "../mastra/tools/search-code.js";
import { searchReviewsTool } from "../mastra/tools/search-reviews.js";
import { searchSchemasTool } from "../mastra/tools/search-schemas.js";
import { searchStandardsTool } from "../mastra/tools/search-standards.js";

const MAX_RESPONSE_SIZE = 100_000; // 100KB max accumulated response

const CHAT_SYSTEM_PROMPT = `You are Tiburcio, a senior developer onboarding assistant for your engineering team.

Your job is to help team members understand your team's codebase, conventions, architecture, database schemas, and recent changes. You have access to tools that search the internal knowledge base — including nightly code review insights and test suggestions.

BEHAVIOR:
1. When asked about coding conventions, standards, or best practices -> use searchStandards.
2. When asked about real code, implementation details, or "how is X done" -> use searchCode. You can filter by repo (e.g. 'api', 'ui', 'batch') for multi-repo projects. Results include symbolName, classContext (parent class header), annotations, and exact line ranges — use these to give precise, navigable answers.
3. When asked about system architecture, flows, or how components connect -> use getArchitecture.
4. When asked about database tables, columns, or relationships -> use searchSchemas.
5. When asked for a specific code template or boilerplate -> use getPattern with the name.
6. If you don't know the exact pattern name, call getPattern without a name to list available patterns first.
7. When asked about recent changes, what merged, or what happened recently -> use searchReviews.
8. When asked to write tests, test recently changed code, or "test yesterday's merges" -> use getTestSuggestions AND searchReviews to understand what changed, then use searchCode to find existing test patterns.
9. When asked "what did I miss?", "what changed this week/month?", or catching up after time away -> use getChangeSummary.
10. For greetings or casual messages, respond warmly and briefly, then ask how you can help with onboarding.
11. If a question spans multiple areas, call multiple tools to build a complete answer.
12. For ambiguous questions, ask a clarifying question before searching.

RESPONSE RULES:
- Base answers ONLY on tool results. If tools return no relevant information, say so honestly and suggest alternative search terms.
- Reference which source the information comes from (e.g., "According to the batch-processing architecture doc...").
- Use markdown formatting: headers, code blocks with language tags (\`\`\`java, \`\`\`typescript, etc.), bullet points.
- Be concise but thorough. Use code examples when they help.
- If tool results contain conflicting information, mention both sources and explain the discrepancy.
- When combining results from multiple tools, clearly indicate which tool provided which information.

STRICT PROHIBITIONS:
- NEVER invent, fabricate, or reference documents not returned by tools.
- NEVER generate URLs or links unless they come from tool results.
- NEVER guess about codebase internals — always search first.
- NEVER mention documents by name unless a tool returned them.
- NEVER claim "I found X results" if tools returned empty results.
- NEVER generate code examples that aren't from tool results unless explicitly asked to write new code.`;

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
      // Load last 20 messages for context
      const history = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.createdAt)
        .limit(20);

      // Sanitize input (strip non-printable control chars, keep \t \n \r)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional input sanitization
      const sanitized = message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();

      const langfuse = getLangfuse();
      const trace = langfuse?.trace({
        name: "chat:stream",
        userId,
        metadata: { conversationId },
        input: { message: sanitized.slice(0, 500) },
      });

      const { textStream } = streamText({
        model: getChatModel(),
        system: CHAT_SYSTEM_PROMPT,
        messages: [
          ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          { role: "user" as const, content: sanitized },
        ],
        tools: {
          searchStandards: searchStandardsTool,
          getPattern: getPatternTool,
          searchCode: searchCodeTool,
          getArchitecture: getArchitectureTool,
          searchSchemas: searchSchemasTool,
          searchReviews: searchReviewsTool,
          getTestSuggestions: getTestSuggestionsTool,
          getNightlySummary: getNightlySummaryTool,
          getChangeSummary: getChangeSummaryTool,
        },
        stopWhen: stepCountIs(10),
        abortSignal: c.req.raw.signal,
      });

      let fullResponse = "";

      for await (const chunk of textStream) {
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

      try { trace?.update({ output: { responseLength: fullResponse.length } }); } catch { /* observability must never crash chat */ }

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
