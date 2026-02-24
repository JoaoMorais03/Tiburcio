area: auth
keyFiles: backend/src/routes/auth.ts, backend/src/server.ts, frontend/src/stores/auth.ts

# Authentication Flow

The application uses JWT-based authentication with bcrypt password hashing.

## Registration
1. Frontend sends `POST /api/auth/register` with `{ username, password }`
2. Backend validates input (Zod), hashes password with bcrypt (salt rounds: 12)
3. Creates user in PostgreSQL, generates JWT with user ID
4. Returns `{ token, user: { id, username } }`

## Login
1. Frontend sends `POST /api/auth/login` with `{ username, password }`
2. Backend looks up user, compares password hash with bcrypt
3. Returns same token + user object on success
4. Returns generic "Invalid credentials" on failure (no username enumeration)

## Token Usage
- Frontend stores JWT in localStorage
- All `/api/chat/*` and `/api/admin/*` routes require `Authorization: Bearer <token>`
- JWT is verified by Hono's built-in JWT middleware (HS256)

## Session Management
- `authFetch()` wrapper auto-injects Bearer token on every request
- On 401 response: clears localStorage, redirects to `/auth`
- On 429 response: shows rate limit toast with retry countdown
- Vue Router guard checks `authStore.isAuthenticated` before protected routes

## Security
- Passwords hashed with bcrypt (not stored in plain text)
- JWT secret from environment variable (never hardcoded)
- Rate limiting on auth endpoints (10 requests per 15 minutes)
- Generic error messages prevent user enumeration
