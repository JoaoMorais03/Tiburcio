// Tests for chat route flows (SSE streaming + conversation CRUD).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/connection.js", () => ({
  db: {
    query: { conversations: { findFirst: vi.fn() } },
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../helpers/conversation.js", () => ({
  resolveConversation: vi.fn(),
}));

vi.mock("../mastra/agents/chat-agent.js", () => ({
  chatAgent: {
    stream: vi.fn(),
  },
}));

vi.mock("../config/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { Hono } from "hono";
import { db } from "../db/connection.js";
import { resolveConversation } from "../helpers/conversation.js";
import { chatAgent } from "../mastra/agents/chat-agent.js";

async function createApp() {
  const { default: chatRouter } = await import("../routes/chat.js");
  const app = new Hono();
  app.use("/*", async (c, next) => {
    c.set("jwtPayload", { sub: "user-123" });
    return next();
  });
  app.route("/chat", chatRouter);
  return app;
}

function jsonPost(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Parse SSE text into an array of { event, data } objects. */
function parseSSE(text: string): Array<{ event: string; data: string }> {
  const events: Array<{ event: string; data: string }> = [];
  let currentEvent = "";
  let currentData = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      currentData = line.slice(5).trim();
    } else if (line === "") {
      if (currentEvent) events.push({ event: currentEvent, data: currentData });
      currentEvent = "";
      currentData = "";
    }
  }
  if (currentEvent) events.push({ event: currentEvent, data: currentData });
  return events;
}

// Tracks db.insert calls
let insertCalls: { table: unknown; values: unknown }[] = [];

function mockInsertTracked(returningValue: unknown[] = []) {
  vi.mocked(db.insert).mockImplementation((table: unknown) => {
    return {
      values: vi.fn().mockImplementation((vals: unknown) => {
        insertCalls.push({ table, values: vals });
        return {
          returning: vi.fn().mockResolvedValue(returningValue),
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        };
      }),
    } as any;
  });
}

function mockUpdate() {
  vi.mocked(db.update).mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  } as any);
}

/** Create an async iterable that yields the given chunks. */
function mockTextStream(chunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

describe("chat routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertCalls = [];
  });

  describe("POST /chat/stream", () => {
    it("streams SSE events: conversation → tokens → done", async () => {
      const app = await createApp();
      const assistantMsg = {
        id: "msg-1",
        role: "assistant",
        content: "Hello!",
        createdAt: new Date(),
      };

      vi.mocked(resolveConversation).mockResolvedValue("conv-123");
      // First insert (user msg) returns nothing, second (assistant msg) returns the message
      let insertCount = 0;
      vi.mocked(db.insert).mockImplementation(
        (table: unknown) =>
          ({
            values: vi.fn().mockImplementation((vals: unknown) => {
              insertCalls.push({ table, values: vals });
              insertCount++;
              return {
                returning: vi.fn().mockResolvedValue(insertCount >= 2 ? [assistantMsg] : []),
                then: (resolve: (v: unknown) => void) => resolve(undefined),
              };
            }),
          }) as any,
      );
      mockUpdate();

      vi.mocked(chatAgent.stream).mockResolvedValue({
        textStream: mockTextStream(["Hel", "lo!"]),
      } as any);

      const res = await app.request(jsonPost("/chat/stream", { message: "Hi there" }));

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const body = await res.text();
      const events = parseSSE(body);

      // First event: conversation ID
      expect(events[0].event).toBe("conversation");
      expect(JSON.parse(events[0].data).conversationId).toBe("conv-123");

      // Token events
      const tokenEvents = events.filter((e) => e.event === "token");
      expect(tokenEvents).toHaveLength(2);
      expect(JSON.parse(tokenEvents[0].data).token).toBe("Hel");
      expect(JSON.parse(tokenEvents[1].data).token).toBe("lo!");

      // Done event with messageId
      const doneEvent = events.find((e) => e.event === "done");
      expect(doneEvent).toBeDefined();
      expect(JSON.parse(doneEvent!.data).messageId).toBe("msg-1");

      // Verify user message was saved before agent was called
      expect(insertCalls[0].values).toEqual(
        expect.objectContaining({
          role: "user",
          content: "Hi there",
          conversationId: "conv-123",
        }),
      );

      // Verify agent received correct memory context
      expect(chatAgent.stream).toHaveBeenCalledWith("Hi there", {
        memory: { thread: "conv-123", resource: "user-123" },
      });

      // Verify assistant message was saved with full concatenated response
      expect(insertCalls[1].values).toEqual(
        expect.objectContaining({
          role: "assistant",
          content: "Hello!",
          conversationId: "conv-123",
        }),
      );
    });

    it("sends SSE error event when agent throws (does not crash)", async () => {
      const app = await createApp();

      vi.mocked(resolveConversation).mockResolvedValue("conv-123");
      mockInsertTracked([]);
      mockUpdate();
      vi.mocked(chatAgent.stream).mockRejectedValue(new Error("OpenRouter down"));

      const res = await app.request(jsonPost("/chat/stream", { message: "Hi there" }));

      expect(res.status).toBe(200); // SSE always starts 200
      const body = await res.text();
      const events = parseSSE(body);

      const errorEvent = events.find((e) => e.event === "error");
      expect(errorEvent).toBeDefined();
      expect(JSON.parse(errorEvent!.data).error).toBe("Failed to generate response");
      // Must NOT leak internal error details
      expect(body).not.toContain("OpenRouter");

      // User message should still have been saved before the agent errored
      expect(insertCalls.length).toBeGreaterThanOrEqual(1);
      expect(insertCalls[0].values).toEqual(
        expect.objectContaining({ role: "user", content: "Hi there" }),
      );
    });

    it("returns 404 when conversationId doesn't belong to user", async () => {
      const app = await createApp();
      vi.mocked(resolveConversation).mockRejectedValue(new Error("Conversation not found"));

      const res = await app.request(
        jsonPost("/chat/stream", {
          message: "Hi",
          conversationId: "00000000-0000-0000-0000-000000000000",
        }),
      );

      expect(res.status).toBe(404);
      expect(resolveConversation).toHaveBeenCalledWith(
        "user-123",
        "00000000-0000-0000-0000-000000000000",
        "Hi",
      );
    });

    it("rejects empty message with 400 — never reaches agent or DB", async () => {
      const app = await createApp();

      const res = await app.request(jsonPost("/chat/stream", { message: "" }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("empty");
      expect(chatAgent.stream).not.toHaveBeenCalled();
      expect(resolveConversation).not.toHaveBeenCalled();
    });

    it("rejects message exceeding max length with 400", async () => {
      const app = await createApp();

      const res = await app.request(jsonPost("/chat/stream", { message: "x".repeat(10001) }));

      expect(res.status).toBe(400);
      expect(chatAgent.stream).not.toHaveBeenCalled();
    });
  });

  describe("GET /chat/conversations", () => {
    it("passes limit and offset from query params to DB", async () => {
      const app = await createApp();
      const mockConvs = [{ id: "conv-1", title: "Chat 1" }];

      const mockOffset = vi.fn().mockResolvedValue(mockConvs);
      const mockLimit = vi.fn().mockReturnValue({ offset: mockOffset });
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

      const res = await app.request(
        new Request("http://localhost/chat/conversations?limit=10&offset=5"),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(mockLimit).toHaveBeenCalledWith(10);
      expect(mockOffset).toHaveBeenCalledWith(5);
    });

    it("caps limit at 100 even if client asks for more", async () => {
      const app = await createApp();
      const mockOffset = vi.fn().mockResolvedValue([]);
      const mockLimit = vi.fn().mockReturnValue({ offset: mockOffset });
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({ limit: mockLimit }),
          }),
        }),
      } as any);

      await app.request(new Request("http://localhost/chat/conversations?limit=999"));
      expect(mockLimit).toHaveBeenCalledWith(100);
    });
  });

  describe("DELETE /chat/conversations/:id", () => {
    it("deletes a conversation owned by the user", async () => {
      const app = await createApp();
      vi.mocked(db.query.conversations.findFirst).mockResolvedValue({
        id: "conv-1",
        userId: "user-123",
      } as any);
      vi.mocked(db.delete).mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      } as any);

      const res = await app.request(
        new Request("http://localhost/chat/conversations/conv-1", {
          method: "DELETE",
        }),
      );

      expect(res.status).toBe(200);
      expect((await res.json()).message).toBe("Conversation deleted");
      expect(db.delete).toHaveBeenCalled();
    });

    it("returns 404 and does NOT delete when user doesn't own conversation", async () => {
      const app = await createApp();
      vi.mocked(db.query.conversations.findFirst).mockResolvedValue(undefined);

      const res = await app.request(
        new Request("http://localhost/chat/conversations/conv-1", {
          method: "DELETE",
        }),
      );

      expect(res.status).toBe(404);
      expect(db.delete).not.toHaveBeenCalled();
    });
  });
});
