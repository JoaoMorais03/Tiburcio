# Prozis Setup Guide — Running Tiburcio on a Corporate Machine

This guide walks you through setting up Tiburcio on a Prozis work machine with Netskope.

## Prerequisites

- Docker Desktop installed and running
- Access to the Tiburcio repo
- An OpenRouter API key (ask the team if you don't have one)
- The ProzisHUB repo cloned locally (for codebase indexing)

## 1. Build the Netskope Certificate Bundle

Netskope intercepts all HTTPS traffic on Prozis machines. Docker containers need the Netskope CA certificates to make any outbound TLS connections (npm install, OpenRouter API calls, etc.).

The Dockerfiles already handle this — you just need to place a `node-certs.pem` file in the repo root.

### 1.1 Export the system CA certificates

```bash
# Export all system certificates (includes Netskope certs installed by IT)
security find-certificate -a -p /Library/Keychains/System.keychain > node-certs.pem
security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain >> node-certs.pem
```

### 1.2 Add the Netskope-specific certificates

These are installed by the Netskope agent and are required for the proxy to work:

```bash
# Netskope CA certificate (the proxy's root CA)
cat "/Library/Application Support/Netskope/STAgent/data/nscacert.pem" >> node-certs.pem

# Netskope tenant certificate (Prozis-specific)
cat "/Library/Application Support/Netskope/STAgent/data/nstenantcert.pem" >> node-certs.pem
```

### 1.3 Verify the bundle

```bash
# Should show 150+ certificates, 0 or very few expired
python3 -c "
import re, subprocess, datetime
with open('node-certs.pem') as f:
    content = f.read()
certs = re.findall(r'-----BEGIN CERTIFICATE-----', content)
print(f'Total certificates: {len(certs)}')
"
```

### 1.4 Set up local Node.js to trust the bundle

Add this to your `~/.zshrc` (for local development outside Docker):

```bash
echo 'export NODE_EXTRA_CA_CERTS=~/node-certs.pem' >> ~/.zshrc
cp node-certs.pem ~/node-certs.pem
source ~/.zshrc
```

> **Note**: The `node-certs.pem` file is in `.gitignore` — it is machine-specific and must never be committed.

## 2. Create the Environment File

```bash
cp .env.example .env
```

Edit `.env` and fill in:

### 2.1 Generate secure secrets

```bash
# Database password (must be URL-safe — no +, /, = characters)
openssl rand -hex 16
# Example output: 754799086c48ba72e2559e1568874dd9

# JWT secret (must be at least 32 characters)
openssl rand -base64 32
# Example output: xuQIvduOwzS/y8F869uwbIGXcuZuh9p5tDsi59y3DfA=
```

### 2.2 Update .env

Replace these values in `.env`:

```env
# Use the hex password from above in BOTH places
DATABASE_URL=postgresql://tiburcio_admin:YOUR_HEX_PASSWORD@db:5432/tiburcio_db
POSTGRES_PASSWORD=YOUR_HEX_PASSWORD

# Your OpenRouter API key
OPENROUTER_API_KEY=sk-or-v1-your-actual-key

# The JWT secret you generated
JWT_SECRET=your-generated-secret-at-least-32-chars
```

Everything else can stay at defaults.

## 3. Configure the Codebase Mount

Edit `.env` and set the codebase repos. ProzisHUB has 3 repos (api, ui, batch) under one parent directory:

```env
# Mount the ProzisHUB parent dir
CODEBASE_HOST_PATH=/Users/yourname/Documents/ProzisHUB

# Index all 3 repos (name:container-path:branch)
CODEBASE_REPOS=api:/codebase/api:develop,ui:/codebase/ui:develop,batch:/codebase/batch:develop
```

The `docker-compose.yml` mounts `CODEBASE_HOST_PATH` as `/codebase` read-only. All 3 sub-repos become available at `/codebase/api`, `/codebase/ui`, `/codebase/batch`.

> The `:ro` flag mounts it read-only — Tiburcio will never modify your code.

## 4. Build and Start

```bash
docker compose up -d --build
```

First run takes ~1 minute to build. You'll see all 6 services start:
- **db** (PostgreSQL)
- **redis**
- **qdrant** (vector database)
- **langfuse** (LLM observability)
- **backend** (Tiburcio API)
- **frontend** (Tiburcio UI)

## 5. Verify

```bash
# Check all services are healthy
docker compose ps

# Check backend health
curl http://localhost:3333/api/health

# Watch the indexing progress (standards + codebase)
docker compose logs -f backend
```

You should see:
- `"Standards indexing complete"` — team docs indexed
- `"Architecture indexing complete"` — architecture docs indexed
- `"Starting codebase indexing"` — ProzisHUB API indexing (takes a few minutes for ~550 files)

## 6. Access

| Service | URL | Notes |
|---------|-----|-------|
| **Tiburcio UI** | http://localhost:5174 | Register an account, then chat |
| **Backend API** | http://localhost:3333 | Health check at `/api/health` |
| **Langfuse** | http://localhost:3001 | LLM observability (admin@tiburcio.local / admin123) |
| **Qdrant** | http://localhost:6333/dashboard | Vector DB dashboard |
| **PostgreSQL** | localhost:5555 | Use credentials from `.env` |

## Troubleshooting

### "TLS: server certificate not trusted" during Docker build

Your `node-certs.pem` is missing or incomplete. Re-run steps 1.1 and 1.2.

### "Invalid URL" error from backend

Your `POSTGRES_PASSWORD` contains special characters (`+`, `/`, `=`). Regenerate it with `openssl rand -hex 16` (hex-only, URL-safe) and update both `POSTGRES_PASSWORD` and `DATABASE_URL` in `.env`. Then:

```bash
docker compose down -v && docker compose up -d --build
```

### "Vector dimension error: expected dim: 1024, got 4096"

Old version of the code. Pull latest — the dimension was fixed to 4096 to match the `qwen/qwen3-embedding-8b` model output.

### Backend keeps restarting

Check the logs:

```bash
docker compose logs backend
```

Common causes:
- Missing `OPENROUTER_API_KEY` — the backend will crash if embedding calls fail
- `JWT_SECRET` too short — must be at least 32 characters

### Codebase not being indexed

Make sure:
1. `CODEBASE_HOST_PATH` in `.env` points to the ProzisHUB parent directory
2. `CODEBASE_REPOS` lists all repos with correct container paths and branch names
3. Each repo directory has a `.git` folder (Tiburcio uses git operations for nightly diffs)

### Clean restart (wipe all data)

```bash
docker compose down -v && docker compose up -d --build
```

This destroys all volumes (database, Redis, Qdrant) and starts fresh.

## Stopping

```bash
docker compose down      # stop services, keep data
docker compose down -v   # stop services AND wipe all data
```
