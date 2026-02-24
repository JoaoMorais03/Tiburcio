// __tests__/mocks/handlers.ts — MSW HTTP handlers for API endpoints.

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

const mockUser = { id: "user-1", username: "testuser" };

const mockConversations = [
  {
    id: "conv-1",
    title: "Test conversation",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "conv-2",
    title: "Another chat",
    createdAt: "2024-01-02T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
  },
];

const mockMessages = [
  {
    id: "msg-1",
    conversationId: "conv-1",
    role: "user",
    content: "Hello",
    createdAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "msg-2",
    conversationId: "conv-1",
    role: "assistant",
    content: "Hi there! How can I help?",
    createdAt: "2024-01-01T00:00:01Z",
  },
];

export const handlers = [
  // Auth (httpOnly cookies — server sets cookies, response only contains user info)
  http.post("/api/auth/login", async ({ request }) => {
    const body = (await request.json()) as {
      username: string;
      password: string;
    };
    if (body.username === "testuser" && body.password === "password") {
      return HttpResponse.json({ user: mockUser });
    }
    return HttpResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }),

  http.post("/api/auth/register", async ({ request }) => {
    const body = (await request.json()) as {
      username: string;
      password: string;
    };
    if (body.username === "existing") {
      return HttpResponse.json({ error: "Registration failed" }, { status: 400 });
    }
    return HttpResponse.json({
      user: { id: "user-new", username: body.username },
    });
  }),

  http.post("/api/auth/refresh", () => {
    return HttpResponse.json({ user: mockUser });
  }),

  http.post("/api/auth/logout", () => {
    return HttpResponse.json({ message: "Logged out" });
  }),

  // Conversations
  http.get("/api/chat/conversations", () => {
    return HttpResponse.json(mockConversations);
  }),

  http.get("/api/chat/conversations/:id/messages", ({ params }) => {
    if (params.id === "conv-1") {
      return HttpResponse.json(mockMessages);
    }
    return HttpResponse.json([]);
  }),

  http.delete("/api/chat/conversations/:id", () => {
    return HttpResponse.json({ ok: true });
  }),

  // Chat stream (SSE)
  http.post("/api/chat/stream", () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('event:conversation\ndata:{"conversationId":"conv-new"}\n\n'),
        );
        controller.enqueue(encoder.encode('event:token\ndata:{"token":"Hello "}\n\n'));
        controller.enqueue(encoder.encode('event:token\ndata:{"token":"world!"}\n\n'));
        controller.enqueue(
          encoder.encode(
            'event:done\ndata:{"messageId":"msg-new","conversationId":"conv-new"}\n\n',
          ),
        );
        controller.close();
      },
    });

    return new HttpResponse(stream, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }),
];

export const server = setupServer(...handlers);
