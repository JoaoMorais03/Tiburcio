# --- Stage 1: Build ---
FROM node:22-alpine AS builder

WORKDIR /app

# Build tools for tree-sitter native bindings (only in build stage, not final image)
RUN apk add --no-cache python3 make g++ && \
    corepack enable && corepack prepare pnpm@10.30.1 --activate

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy only the backend manifest (for dependency resolution)
COPY backend/package.json backend/package.json

# Install backend deps only (workspace-aware)
RUN pnpm install --frozen-lockfile --filter tiburcio-backend...

# Copy backend source
COPY backend/ backend/

# Build
RUN pnpm --filter tiburcio-backend build

# Deploy: standalone directory with production deps only
RUN pnpm deploy --filter tiburcio-backend --prod /app/prod

# --- Stage 2: Production ---
FROM node:22-alpine AS runner

RUN apk add --no-cache git && \
    addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser

WORKDIR /app

COPY --from=builder --chown=appuser:appgroup /app/prod/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/prod/package.json ./
COPY --from=builder --chown=appuser:appgroup /app/backend/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/backend/drizzle ./drizzle

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
