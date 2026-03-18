---
title: "feat: MCP Marketplace Submission Readiness — 9.5 code + 10/10 docs"
type: feat
status: active
date: 2026-03-08
---

# MCP Marketplace Submission Readiness

Bring Tiburcio to 9.5/10 code quality and 10/10 documentation quality, then submit to Smithery.ai and Anthropic's official MCP Connectors Directory (Desktop Extension / `.mcpb` local track).

## Overview

Tiburcio's MCP implementation is already best-in-class (Zod schemas, compact mode, timing-safe auth, confidence thresholds, hybrid search). The gaps are almost entirely documentation and registry metadata — none require architectural changes. The plan executes in three phases: code polish, docs to 10/10, then submission.

**Submission targets:**
1. **Smithery.ai** — open community registry, nearly immediate listing, zero review friction
2. **Anthropic Connectors Directory — Local track (`.mcpb` Desktop Extension)** — official Anthropic listing for self-hosted/local servers. Right track for Tiburcio because it requires local Docker infrastructure and local codebase access.
3. **Anthropic Connectors Directory — Remote track** — requires OAuth 2.0, hosted deployment, IP allowlisting. Out of scope for v2.1. Tracked separately for v3.

---

## Why Local Track (Not Remote)

The remote track requires a **publicly hosted server** with OAuth 2.0 authorization code flow, valid TLS from recognized CAs, Claude IP allowlisting, and full cloud infrastructure. Tiburcio requires local Docker (Qdrant, Postgres, Redis, Ollama) and access to the user's local codebase — it is architecturally a **local tool**. The `.mcpb` Desktop Extension track is the correct submission path and directly matches Tiburcio's value proposition.

---

## Phase 1: Code Polish — Reach 9.5/10

### 1.1 Add `title` field to all 10 MCP tools

The 2025-06-18 MCP spec added a `title` field (human-readable display name, separate from `name`). Anthropic's directory surfaces this in the UI. Without it, the machine-readable name (e.g., `searchCode`) is shown raw.

**File:** `backend/src/mcp-tools.ts`

Add `title` to each tool registration:

```typescript
// mcp-tools.ts — example for searchStandards
server.registerTool("searchStandards", {
  title: "Search Team Standards",        // ← ADD THIS
  description: "...",
  inputSchema: { ... },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, executeSearchStandards);
```

All 10 tools need a `title`:
| Tool name | Title |
|---|---|
| `searchStandards` | Search Team Standards |
| `searchCode` | Search Codebase |
| `getArchitecture` | Get Architecture Docs |
| `getSchemas` | Get Database Schemas |
| `getPattern` | Get Code Patterns |
| `searchReviews` | Search Code Reviews |
| `getNightlySummary` | Get Nightly Review Summary |
| `getChangeSummary` | Get Change Summary |
| `getTestSuggestions` | Get Test Suggestions |
| `getImpactAnalysis` | Get Impact Analysis |

**Also add `idempotentHint: true`** to all tools — calling any search tool multiple times has the same effect as once.

```typescript
annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
```

### 1.2 Fix tool description for `getArchitecture`

`backend/src/mcp-tools.ts` — `getArchitecture` description says "flow diagrams" but the tool searches text docs, not visual diagrams. This is misleading. Change to: `"Search architecture decision records, system design docs, and component diagrams indexed from your docs/."`.

### 1.3 Fix tool description for `getImpactAnalysis`

Currently: `"Returns available: false if graph features are not configured (NEO4J_URI not set)."`

Add: `"Note: function-level impact (method-to-method edges) requires Neo4j configured with graph data — file-level impact works without Neo4j."`

### 1.4 Verify token limits

The Anthropic directory hard-limits tool results to **25,000 tokens**. Tiburcio's compact mode caps at ~1,500 tokens and full mode at ~8,000 tokens. Already safe. Add a comment in `backend/src/mastra/tools/truncate.ts` documenting this limit explicitly.

### 1.5 Add `outputSchema` to tools (optional but recommended)

The new MCP spec supports `outputSchema` for structured output validation. Not hard-required for submission but signals quality. Add a simple JSON Schema on the two most-used tools (`searchCode`, `searchStandards`) as a starting point:

```typescript
// In mcp-tools.ts registration
outputSchema: z.object({
  results: z.array(z.object({
    filePath: z.string(),
    symbolName: z.string().optional(),
    summary: z.string(),
    score: z.number(),
  })),
  message: z.string().optional(),
}),
```

---

## Phase 2: Documentation to 10/10

### 2.1 Create `smithery.yaml`

**File:** `smithery.yaml` (repo root)

Required for Smithery.ai listing. Defines how Smithery builds and runs the server:

```yaml
# smithery.yaml
build:
  dockerBuildPath: ./
  dockerfile: backend/Dockerfile

startCommand:
  type: stdio
  configSchema:
    type: object
    required:
      - postgresUrl
      - redisUrl
      - qdrantUrl
    properties:
      postgresUrl:
        type: string
        description: "PostgreSQL connection string (e.g. postgres://tiburcio:password@localhost:5432/tiburcio)"
      redisUrl:
        type: string
        description: "Redis connection string (e.g. redis://localhost:6379)"
      qdrantUrl:
        type: string
        description: "Qdrant HTTP URL (e.g. http://localhost:6333)"
      jwtSecret:
        type: string
        description: "JWT signing secret — minimum 32 characters"
        sensitive: true
      teamApiKey:
        type: string
        description: "Bearer token for MCP HTTP/SSE transport"
        sensitive: true
      modelProvider:
        type: string
        description: "LLM provider: 'ollama' (default) or 'openai-compatible'"
        default: "ollama"
  commandFunction: |-
    (config) => ({
      command: 'node',
      args: ['dist/mcp.js'],
      env: {
        DATABASE_URL: config.postgresUrl,
        REDIS_URL: config.redisUrl,
        QDRANT_URL: config.qdrantUrl,
        JWT_SECRET: config.jwtSecret,
        TEAM_API_KEY: config.teamApiKey,
        MODEL_PROVIDER: config.modelProvider || 'ollama',
        NODE_ENV: 'production'
      }
    })
```

### 2.2 Create `manifest.json` for `.mcpb` Desktop Extension track

**File:** `manifest.json` (repo root)

Required for Anthropic's local MCP server submission. Schema version 0.3:

```json
{
  "manifest_version": "0.3",
  "name": "tiburcio",
  "display_name": "Tiburcio — Developer Intelligence MCP",
  "version": "2.1.0",
  "description": "Indexes your team's source code, conventions, and architecture docs into Qdrant, then exposes 10 MCP tools that give Claude Code deep context about your codebase. Includes nightly code review and test suggestion pipeline.",
  "long_description": "Tiburcio is a self-hosted developer intelligence layer for Claude Code. It uses hybrid search (dense vectors + BM25 with RRF fusion) and contextual retrieval (Anthropic technique) to answer questions about your codebase with precision. All 10 tools operate in compact mode by default (300–1,500 tokens per call), with full mode available for deep dives. A nightly BullMQ pipeline reviews merged code against your team's conventions and generates test suggestions. Works with Ollama (zero API cost) or any OpenAI-compatible endpoint.",
  "author": {
    "name": "João Morais",
    "url": "https://github.com/JoaoMorais03"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/JoaoMorais03/tiburcio"
  },
  "homepage": "https://github.com/JoaoMorais03/tiburcio",
  "documentation": "https://github.com/JoaoMorais03/tiburcio#readme",
  "support": "https://github.com/JoaoMorais03/tiburcio/issues",
  "license": "MIT",
  "keywords": ["mcp", "claude-code", "developer-tools", "code-intelligence", "rag", "vector-search", "codebase"],
  "privacy_policies": [],
  "server": {
    "type": "node",
    "entry_point": "dist/mcp.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/dist/mcp.js"],
      "env": {
        "DATABASE_URL": "${user_config.database_url}",
        "REDIS_URL": "${user_config.redis_url}",
        "QDRANT_URL": "${user_config.qdrant_url}",
        "JWT_SECRET": "${user_config.jwt_secret}",
        "MODEL_PROVIDER": "${user_config.model_provider}",
        "NODE_ENV": "production"
      }
    }
  },
  "user_config": {
    "database_url": {
      "type": "string",
      "title": "PostgreSQL URL",
      "description": "postgres://user:password@host:5432/tiburcio",
      "required": true
    },
    "redis_url": {
      "type": "string",
      "title": "Redis URL",
      "description": "redis://localhost:6379",
      "required": true
    },
    "qdrant_url": {
      "type": "string",
      "title": "Qdrant URL",
      "description": "http://localhost:6333",
      "required": true
    },
    "jwt_secret": {
      "type": "string",
      "title": "JWT Secret",
      "description": "Random string, minimum 32 characters",
      "required": true,
      "sensitive": true
    },
    "model_provider": {
      "type": "string",
      "title": "Model Provider",
      "description": "ollama (default) or openai-compatible",
      "required": false
    }
  },
  "tools": [
    { "name": "searchStandards", "description": "Search team coding conventions and best practices" },
    { "name": "searchCode", "description": "Search codebase implementations with hybrid dense+BM25 search" },
    { "name": "getArchitecture", "description": "Search architecture decision records and system design docs" },
    { "name": "getSchemas", "description": "Search database schemas and data models" },
    { "name": "getPattern", "description": "Retrieve code pattern templates" },
    { "name": "searchReviews", "description": "Search AI-generated nightly code review findings" },
    { "name": "getNightlySummary", "description": "Get last nightly review pipeline summary" },
    { "name": "getChangeSummary", "description": "Get summary of recent code changes" },
    { "name": "getTestSuggestions", "description": "Get AI-generated test suggestions for untested code" },
    { "name": "getImpactAnalysis", "description": "Analyze blast radius of code changes (requires Neo4j)" }
  ]
}
```

### 2.3 Add Privacy Policy

Tiburcio is **self-hosted** — all data stays on the user's infrastructure. No data is sent to external services beyond whatever inference provider the user configures (Ollama = fully local; OpenRouter = user's own account). This is a strong privacy story.

Add `PRIVACY.md` to repo root and add a Privacy section to README.

**`PRIVACY.md`:**
```markdown
# Privacy Policy

Tiburcio is self-hosted software. All data (source code, conventions, embeddings, conversations) is stored exclusively on your own infrastructure (PostgreSQL, Redis, Qdrant).

## Data Flows

- **Inference**: Chunk text is sent to your configured LLM provider for embedding and generation. Default is Ollama (fully local). If you configure OpenRouter or another provider, their privacy policy applies to inference calls.
- **Secret Redaction**: Before any text is sent to inference APIs, `redactSecrets()` strips API keys, connection strings, bearer tokens, AWS keys, and private key material.
- **No telemetry**: Tiburcio does not collect usage metrics, crash reports, or any data from your deployment.

## Data Stored Locally

- Source code chunks (Qdrant vector collections)
- Team convention documents (Qdrant)
- Architecture and schema documents (Qdrant)
- Nightly review findings (Qdrant)
- User accounts and conversation history (PostgreSQL)
- Session tokens (Redis)

## Third-Party Services

Tiburcio optionally integrates with:
- **Ollama** — local inference, no data leaves your machine
- **OpenRouter / OpenAI-compatible endpoints** — inference only, governed by your provider's policy
- **Neo4j** — optional graph layer, self-hosted or cloud (your choice)
- **Langfuse** — optional observability, self-hosted or cloud (your choice)
```

### 2.4 Create `docs/DEPLOYMENT.md`

Production deployment guide covering:

- Prerequisites (Docker Compose, hardware requirements: 4GB RAM minimum, 8GB recommended)
- Full stack deployment with `docker compose up -d --build`
- Reverse proxy setup (nginx example with TLS)
- Environment variable checklist (required vs optional)
- First-run sequence (start → migrate → index)
- Health check validation (`docker compose ps`, service health endpoints)
- Backup strategy (pg_dump for Postgres, Qdrant snapshot API)
- Upgrade guide (how to update to a new version)
- Scaling considerations (BullMQ worker concurrency, p-limit tuning)

### 2.5 Create `docs/TROUBLESHOOTING.md`

Common issues and resolutions:

| Symptom | Cause | Fix |
|---|---|---|
| `embedding dimensions mismatch` | Switched MODEL_PROVIDER without wiping Qdrant | Automatic — restart backend, Qdrant collections auto-recreate |
| Indexing stuck at same file count | p-limit deadlock or inference API rate limit | Check BullMQ dashboard, reduce PNPM_CONCURRENT |
| `JWT_SECRET` env validation error | Less than 32 chars | `openssl rand -base64 32` |
| `TEAM_API_KEY` returns 503 | Env var not set | Add to .env and restart backend |
| Qdrant health check failing | Port conflict or memory | Check `docker compose ps`, verify 6333 not in use |
| `pino-pretty` crash in production | NODE_ENV not set to `production` | Set `NODE_ENV=production` in .env |
| Tree-sitter build fails | Missing build tools | Build stage in Dockerfile includes python3/make/g++ — rebuild image |
| `nightly review` finds no changes | No merges since last SHA | Normal — check Redis `tiburcio:codebase-head:*` keys |

### 2.6 Add 3 Required Usage Examples

Anthropic's submission guide requires **minimum 3 working usage examples** — realistic prompts, actual tool call, expected output. Add a `docs/USAGE_EXAMPLES.md` and link from README:

**Example 1 — Convention lookup:**
```
User: "How does our team handle database transactions?"
Claude calls: searchStandards({ query: "database transactions" })
Returns: Convention doc excerpt from standards/backend/transactions.md showing the team's try-catch + rollback pattern
```

**Example 2 — Code pattern search:**
```
User: "Show me how we implement pagination in this codebase"
Claude calls: searchCode({ query: "pagination", language: "typescript", compact: false })
Returns: 3 matching implementations with file paths, line ranges, and class context
```

**Example 3 — Nightly review lookup:**
```
User: "Did our last PR have any convention violations?"
Claude calls: getNightlySummary({ compact: false })
Returns: Summary of last nightly review: 2 warnings about missing error handling in PaymentService, 1 test suggestion for UserController
```

**Example 4 — Impact analysis (bonus):**
```
User: "What breaks if I refactor the UserRepository class?"
Claude calls: getImpactAnalysis({ entity: "UserRepository", depth: 2 })
Returns: List of files and services that import UserRepository, with dependency depth
```

### 2.7 Update README — Fill Remaining Gaps

1. **Add Privacy section** (link to PRIVACY.md)
2. **Add links to DEPLOYMENT.md and TROUBLESHOOTING.md** in the "Getting Started" section
3. **Add link to USAGE_EXAMPLES.md** in the MCP Tools section
4. **Clarify Langfuse status** — change "not yet active" to "optional — can be enabled by configuring LANGFUSE_* vars"
5. **Add `.tibignore` section** — currently only in CLAUDE.md, not discoverable from README
6. **Fix admin curl example** (line 249) — add note that you need the httpOnly session cookie first
7. **Add explicit REQUIRED vs OPTIONAL column** to env var table

### 2.8 Update CONTRIBUTING.md

1. Fix test count: verify and update to actual count (137 backend + 30 frontend = 167)
2. Add note explaining what CLAUDE.md does for Claude Code contributors
3. Add link to DEPLOYMENT.md for contributors who want to test Docker builds

### 2.9 Add GitHub Feature Request Template

**File:** `.github/ISSUE_TEMPLATE/feature_request.md`

Standard template:
```markdown
---
name: Feature request
about: Suggest an idea for Tiburcio
labels: enhancement
---

## Problem Statement
What problem are you trying to solve?

## Proposed Solution
What would you like to happen?

## Alternatives Considered
What other solutions have you considered?

## Additional Context
Any other context, links, or examples.
```

### 2.10 Fix CHANGELOG.md — Document v2.1.0 test count

Add to v2.1.0 entry:
```markdown
- Tests: 167 total (137 backend + 30 frontend)
```

---

## Phase 3: Submission

### 3.1 Smithery.ai

1. Commit `smithery.yaml` to main
2. Go to https://smithery.ai and sign in with GitHub
3. Submit repo URL: `https://github.com/JoaoMorais03/tiburcio`
4. Category: Developer Tools
5. Smithery auto-discovers `smithery.yaml` and lists the server

### 3.2 Anthropic Connectors Directory — Local Track

1. Install mcpb: `npm install -g @anthropic-ai/mcpb`
2. Ensure `manifest.json`, `README.md`, `LICENSE`, and a 512×512px icon PNG exist
3. Run: `mcpb pack` — produces `tiburcio-2.1.0.mcpb`
4. Test the bundle: `mcpb info tiburcio-2.1.0.mcpb`
5. Test in Claude Desktop end-to-end
6. Submit via: https://forms.gle/tyiAZvch1kDADKoP9

### 3.3 Icon

Need a 512×512px PNG icon (required for `.mcpb` packaging and Smithery listing). Options:
- Use the existing logo if the repo has one
- Generate one representing "developer intelligence / code search"

---

## Acceptance Criteria

### Code (9.5/10)
- [ ] `title` field added to all 10 tools in `mcp-tools.ts`
- [ ] `idempotentHint: true` added to all tool annotations
- [ ] `getArchitecture` description fixed (no "flow diagrams")
- [ ] `getImpactAnalysis` description clarifies function-level limitation
- [ ] Token limit comment added to `truncate.ts`
- [ ] `outputSchema` added to `searchCode` and `searchStandards`

### Documentation (10/10)
- [ ] `smithery.yaml` created at repo root
- [ ] `manifest.json` created at repo root (mcpb schema v0.3)
- [ ] `PRIVACY.md` created at repo root
- [ ] `docs/DEPLOYMENT.md` created
- [ ] `docs/TROUBLESHOOTING.md` created
- [ ] `docs/USAGE_EXAMPLES.md` created with 4 examples
- [ ] README updated: privacy section, deployment/troubleshooting links, .tibignore, usage examples link, env var table improved
- [ ] CONTRIBUTING.md: test count fixed, CLAUDE.md explanation added
- [ ] CHANGELOG.md: v2.1.0 test count added
- [ ] `.github/ISSUE_TEMPLATE/feature_request.md` created

### Submission Ready
- [ ] 512×512px icon PNG exists
- [ ] `mcpb pack` completes without errors
- [ ] Bundle verified with `mcpb info`
- [ ] `smithery.yaml` validated by Smithery CLI
- [ ] All docs linked from README and discoverable
- [ ] Privacy Policy publicly accessible
- [ ] Support channel (GitHub Issues) linked in manifest

---

## Files to Create / Modify

| File | Action | Phase |
|---|---|---|
| `backend/src/mcp-tools.ts` | Edit — add `title`, `idempotentHint`, `outputSchema`, fix 2 descriptions | 1 |
| `backend/src/mastra/tools/truncate.ts` | Edit — add 25k token limit comment | 1 |
| `smithery.yaml` | Create | 2 |
| `manifest.json` | Create | 2 |
| `PRIVACY.md` | Create | 2 |
| `docs/DEPLOYMENT.md` | Create | 2 |
| `docs/TROUBLESHOOTING.md` | Create | 2 |
| `docs/USAGE_EXAMPLES.md` | Create | 2 |
| `README.md` | Edit — 7 targeted additions | 2 |
| `docs/CONTRIBUTING.md` | Edit — test count, CLAUDE.md note | 2 |
| `docs/CHANGELOG.md` | Edit — v2.1.0 test count | 2 |
| `.github/ISSUE_TEMPLATE/feature_request.md` | Create | 2 |
| `assets/icon.png` (512×512) | Create | 3 |

---

## Sources & References

- [Anthropic Remote MCP Submission Guide](https://support.claude.com/en/articles/12922490-remote-mcp-server-submission-guide)
- [Anthropic Local MCP Submission Guide](https://support.claude.com/en/articles/12922832-local-mcp-server-submission-guide)
- [Anthropic MCP Directory Policy](https://support.claude.com/en/articles/11697096-anthropic-mcp-directory-policy)
- [mcpb manifest.json schema v0.3](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md)
- [MCP Tools Spec — title + outputSchema + annotations](https://modelcontextprotocol.io/docs/concepts/tools)
- [Smithery Registry](https://smithery.ai)
- [smithery.yaml format](https://github.com/smithery-ai/cli)
- [MCP Specification 2025-03-26](https://modelcontextprotocol.io/specification/2025-03-26)
- `backend/src/mcp-tools.ts` — all 10 tool registrations
- `backend/src/routes/mcp.ts` — HTTP/SSE transport implementation
