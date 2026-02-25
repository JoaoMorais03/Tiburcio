# --- Stage 1: Build ---
FROM node:22-alpine AS builder

WORKDIR /app

# Corporate proxy CA cert: inject before any network calls
COPY node-certs.pe[m] /usr/local/share/ca-certificates/node-certs.pem
RUN if [ -f /usr/local/share/ca-certificates/node-certs.pem ]; then \
    cat /usr/local/share/ca-certificates/node-certs.pem >> /etc/ssl/certs/ca-certificates.crt; \
    fi
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/node-certs.pem

RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy only the frontend manifest
COPY frontend/package.json frontend/package.json

# Install frontend deps only (workspace-aware)
RUN pnpm install --frozen-lockfile --filter tiburcio-frontend...

# Copy frontend source
COPY frontend/ frontend/

# Build static assets
RUN pnpm --filter tiburcio-frontend build

# --- Stage 2: Production ---
FROM nginx:alpine AS runner

COPY --from=builder /app/frontend/dist /usr/share/nginx/html

# SPA fallback: all routes serve index.html
RUN printf 'server {\n  listen 5173;\n  root /usr/share/nginx/html;\n  location /api/ {\n    proxy_pass http://backend:3000;\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n  }\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 5173

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:5173/ || exit 1
