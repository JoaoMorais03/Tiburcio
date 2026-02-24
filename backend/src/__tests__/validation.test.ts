// Tests for request body validation schemas used in auth and chat routes.

import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

// Auth schema (mirrors routes/auth.ts)
const authBody = z.object({
  username: z
    .string()
    .min(2)
    .transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8),
});

// Chat schema (mirrors routes/chat.ts)
const chatBody = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(10000),
});

describe("authBody schema", () => {
  it("parses valid input", () => {
    const result = authBody.safeParse({ username: "Alice", password: "pass1234" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe("alice"); // trimmed + lowercased
    }
  });

  it("trims and lowercases username", () => {
    const result = authBody.safeParse({ username: "  BOB  ", password: "pass1234" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe("bob");
    }
  });

  it("rejects short username", () => {
    const result = authBody.safeParse({ username: "A", password: "pass1234" });
    expect(result.success).toBe(false);
  });

  it("rejects short password", () => {
    const result = authBody.safeParse({ username: "alice", password: "short" });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(authBody.safeParse({}).success).toBe(false);
    expect(authBody.safeParse({ username: "alice" }).success).toBe(false);
    expect(authBody.safeParse({ password: "pass1234" }).success).toBe(false);
  });
});

describe("chatBody schema", () => {
  it("parses valid message without conversationId", () => {
    const result = chatBody.safeParse({ message: "Hello" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conversationId).toBeUndefined();
    }
  });

  it("parses valid message with conversationId", () => {
    const result = chatBody.safeParse({
      conversationId: "550e8400-e29b-41d4-a716-446655440000",
      message: "Hello",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty message", () => {
    const result = chatBody.safeParse({ message: "" });
    expect(result.success).toBe(false);
  });

  it("rejects message exceeding max length", () => {
    const result = chatBody.safeParse({ message: "x".repeat(10001) });
    expect(result.success).toBe(false);
  });

  it("rejects invalid UUID", () => {
    const result = chatBody.safeParse({ conversationId: "not-a-uuid", message: "Hello" });
    expect(result.success).toBe(false);
  });
});
