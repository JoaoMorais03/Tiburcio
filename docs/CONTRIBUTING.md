# Contributing to Tiburcio

Thanks for your interest in contributing! Tiburcio is a developer intelligence MCP — a codebase intelligence layer that makes Claude Code actually understand your team's codebase, conventions, and recent changes.

## Claude Code

This project ships with a [`CLAUDE.md`](../CLAUDE.md) that gives Claude Code full project context. If you use Claude Code, it works out of the box — just clone and start working.

## Development Setup

```bash
# Clone and install
git clone https://github.com/JoaoMorais03/tiburcio.git
cd tiburcio
pnpm install

# Start infrastructure
docker compose up db redis qdrant -d

# Copy env and configure
cp .env.example .env
# Edit .env — at minimum set OPENROUTER_API_KEY

# Run migrations
cd backend && pnpm db:migrate

# Start dev servers
pnpm dev  # from root — starts both backend and frontend
```

## Architecture Overview

Tiburcio operates in two modes:

- **Day mode**: 8 MCP tools serve Claude Code (primary) and the chat UI (secondary). Each tool returns compact, token-efficient answers from Qdrant vector collections.
- **Night mode**: BullMQ cron jobs run at 2 AM to re-index changed files, review yesterday's merges against team standards, and generate test suggestions.

Key areas of the codebase:
- `backend/src/mastra/infra.ts` — Shared singletons (qdrant, models, ensureCollection)
- `backend/src/mastra/agents/` — Chat agent + code review agent
- `backend/src/mastra/tools/` — 8 RAG tools (Qdrant vector search, compact mode default)
- `backend/src/mastra/workflows/` — Nightly review workflow (multi-step)
- `backend/src/indexer/` — Code chunking, embedding, indexing pipelines
- `backend/src/jobs/` — BullMQ background jobs and nightly cron schedule
- `backend/src/routes/` — HTTP endpoints (auth, chat SSE, admin)
- `frontend/src/stores/` — Pinia state management (auth, chat, rate-limit)
- `standards/` — Sample knowledge base (replace with your own docs)

## Code Style

- **Linting**: [Biome](https://biomejs.dev/) — run `pnpm check` in backend or frontend
- **Formatting**: Biome handles formatting too — 2 spaces, double quotes, semicolons, trailing commas
- **TypeScript**: Strict mode enabled. No `any` in production code (allowed in tests).

```bash
# Check lint + types
cd backend && pnpm check
cd frontend && pnpm check
```

## Running Tests

```bash
# Backend tests (136 tests, no external deps needed)
cd backend && pnpm test

# Frontend tests (30 tests)
cd frontend && pnpm test
```

## Continuous Integration

All PRs run automated checks via GitHub Actions:
- **Lint & Type Check** — Biome + TypeScript on both backend and frontend
- **Tests** — 132 backend unit tests + 30 frontend unit tests
- **Docker Build** — Validates multi-stage builds for both services

To run the same checks locally before pushing:
```bash
pnpm check  # Lint + type check
pnpm test   # Run all tests
```

### Releases

Tagging a version (e.g., `v2.2.0`) triggers the release workflow:
1. Docker image builds for backend + frontend
2. Push to GitHub Container Registry (ghcr.io)
3. GitHub Release with auto-generated changelog

To create a release (maintainers only):
```bash
git tag v1.0.0
git push origin v1.0.0
```

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Branch naming: `feat/description`, `fix/description`, `docs/description`
3. Make your changes — keep PRs focused on a single concern
4. Run `pnpm check` and `pnpm test` in the affected package(s)
5. Write a clear PR description explaining what and why
6. Submit the PR — a maintainer will review it

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add conversation search
fix: handle SSE reconnection on token expiry
docs: update MCP setup instructions
refactor: extract embedding logic to shared module
test: add admin route integration tests
```

## Areas Where Contributions Are Welcome

### Nightly Intelligence (High Impact)
- Convention adherence scoring and drift reports
- Change summaries ("what did I miss?")
- Enhanced test suggestion quality

### MCP & Developer Experience
- HTTP/SSE MCP transport for shared team deployment
- Additional MCP tools (getChangeSummary, getConventionReport, getIndexStatus)
- Token efficiency improvements across all tools

### Knowledge & RAG
- Improved chunking strategies (more languages, better boundaries)
- Embedding model alternatives
- Knowledge gap detection (under-documented code areas)

### Infrastructure
- Webhook-triggered incremental indexing
- Git clone support for remote repos
- Notification integrations (Slack/Discord summaries from nightly pipeline)

## Reporting Bugs

Open an issue using the **Bug Report** template. Include:
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Node.js version, Docker version)

## Suggesting Features

Open an issue using the **Feature Request** template. Describe:
- The problem you're trying to solve
- Your proposed solution
- Alternatives you've considered
