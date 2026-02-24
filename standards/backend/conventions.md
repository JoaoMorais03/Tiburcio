# Backend Conventions

Our backend uses Hono with TypeScript on Node.js 22. We follow these conventions for API design and code organization.

## Project Layout

The backend is organized into layers:
- `routes/` — HTTP handlers, request validation, response formatting
- `services/` — Business logic, orchestration, external API calls
- `db/` — Database schema, connection, migrations
- `types/` — Shared TypeScript interfaces
- `utils/` — Pure helper functions

Routes call services. Services call the database. Never import `db` directly in a route file — go through a service when business logic is involved.

## Error Handling

Return consistent error responses with HTTP status codes:

```typescript
// 400 for validation errors
return c.json({ error: "title is required" }, 400)

// 404 for missing resources
return c.json({ error: "Document not found" }, 404)

// 500 for server errors (log the actual error, return generic message)
console.error("Database error:", err)
return c.json({ error: "Internal server error" }, 500)
```

Always catch errors in route handlers. Never let unhandled exceptions crash the server.

## Environment Variables

All configuration comes from environment variables via `.env`. Never hardcode URLs, ports, or credentials. Access them with `process.env.VARIABLE_NAME` and validate at startup:

```typescript
const PORT = parseInt(process.env.PORT || "3000", 10)
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required")
}
```

## Database Queries

Use Drizzle ORM for all database operations. Prefer the query builder over raw SQL unless you need pgvector-specific features:

```typescript
// Good: Drizzle query builder
const doc = await db.query.documents.findFirst({
  where: eq(documents.id, id),
})

// OK: Raw SQL for pgvector operations
const results = await db.execute(sql`
  SELECT *, 1 - (embedding <=> ${vector}::vector) as similarity
  FROM chunks ORDER BY embedding <=> ${vector}::vector LIMIT 5
`)
```

## API Response Format

Always return JSON. List endpoints return arrays. Single-resource endpoints return objects. Error endpoints return `{ error: string }`. Include relevant metadata:

```typescript
// List
return c.json(documents)

// Created
return c.json(document, 201)

// Error
return c.json({ error: "Not found" }, 404)
```

## Streaming Responses

For chat streaming, we use Server-Sent Events (SSE) via Hono's `streamSSE` helper. Events are typed: `token` for individual tokens, `sources` for source attribution, and `done` for completion.
