# Pattern: New API Endpoint

## Steps

1. **Define the schema** with Zod validation:
   ```typescript
   import { z } from "zod/v4";

   const createItemSchema = z.object({
     name: z.string().min(1).max(100),
     categoryId: z.string().uuid(),
   });
   ```

2. **Create the route handler** in `routes/`:
   ```typescript
   import { Hono } from "hono";
   import type { JwtVariables } from "hono/jwt";
   import { z } from "zod/v4";
   import { db } from "../db/connection.js";
   import { items } from "../db/schema.js";

   const itemRouter = new Hono<{ Variables: JwtVariables }>();

   itemRouter.post("/", async (c) => {
     const body = await c.req.json();
     const parsed = createItemSchema.safeParse(body);

     if (!parsed.success) {
       return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
     }

     const userId = c.get("jwtPayload").sub;
     const [item] = await db.insert(items).values({ ...parsed.data, userId }).returning();
     return c.json(item, 201);
   });

   export default itemRouter;
   ```

3. **Mount the router** in `server.ts`:
   ```typescript
   import itemRouter from "./routes/items.js";
   app.route("/api/items", itemRouter);
   ```

4. **Add JWT middleware** if the endpoint needs authentication:
   ```typescript
   app.use("/api/items/*", jwt({ secret: env.JWT_SECRET, alg: "HS256" }));
   ```

5. **Add rate limiting** if the endpoint is public or high-traffic:
   ```typescript
   app.use("/api/items/*", itemLimiter);
   ```

## Conventions
- Validate all input with Zod schemas
- Return `201` for created resources, `200` for success, `4xx` for client errors
- Always return `{ error: string }` for error responses
- Use Drizzle query builder — avoid raw SQL unless needed for vector operations
- Add pagination with `limit` and `offset` query params for list endpoints — never return unbounded results
