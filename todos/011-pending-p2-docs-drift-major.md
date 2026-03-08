---
status: complete
priority: p2
issue_id: "011"
tags: [code-review, documentation]
dependencies: []
---

# Major Documentation Drift — README and CLAUDE.md Don't Reflect Reality

## Problem Statement

After the v2.1 pivot (Mastra removal + graph layer + 10th tool), significant documentation has not been updated. README.md and CLAUDE.md contain stale references that actively mislead contributors and users about the technology stack, tool count, env vars, and architecture.

## Findings

### README.md issues:
- **Version badge** (`README.md:10`): shows `v2.0.0` — actual version is `v2.1.0`
- **Tool count** (`README.md:26,47,65,180,196,316`): says "9 tools" everywhere — there are 10 (`getImpactAnalysis` was added)
- **`getImpactAnalysis` missing** from tools table (`README.md:199-208`) — not listed at all
- **Tech stack table** (`README.md:265-276`): references Mastra (`@mastra/mcp`, `Mastra AI framework`), wrong default provider (`openrouter` not `ollama`), wrong embedding provider
- **Project structure** (`README.md:314-316`): shows `mastra/agents/` (deleted) and "8 RAG tools"
- **Configuration table** (`README.md:342-361`): documents `MODEL_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `EMBEDDING_MODEL`, `EMBEDDING_PROVIDER` — none of these env vars exist in `config/env.ts`
- **Langfuse**: documented as active observability service but not wired in backend code
- **Test count** (`README.md:277`): says "166 tests (136 backend + 30 frontend)" — CLAUDE.md says "137 tests"

### CLAUDE.md issues:
- **"9 MCP tools"** multiple places — there are 10
- **"StreamableHTTPServerTransport"** in Gotchas — code uses `SSEServerTransport` (`routes/mcp.ts:11`)
- **"infra.ts exports rawQdrant + ensureCollection (no chatModel/embeddingModel)"** — infra.ts DOES export chatModel and embeddingModel (`infra.ts:18-21`)

### CHANGELOG.md:
- No `v2.1.0` entry — Mastra removal, RAG hardening, Neo4j graph layer, `getImpactAnalysis` tool all undocumented

## Proposed Solutions

### Single documentation pass (Recommended)
One commit that fixes all of the above in one pass:
1. Update version badge to `v2.1.0` in README.md
2. Replace all "9 tools" with "10 tools" in README.md and CLAUDE.md
3. Add `getImpactAnalysis` to the README tools table
4. Replace the tech stack table with actual stack (`@modelcontextprotocol/sdk` + Vercel AI SDK v6)
5. Fix env var documentation to match `config/env.ts` actual vars
6. Remove `mastra/agents/` from project structure
7. Fix CLAUDE.md Gotchas: `SSEServerTransport`, infra.ts actual exports
8. Add v2.1.0 entry to CHANGELOG.md
9. Clarify Langfuse status (env vars accepted but not actively instrumented)

**Effort:** Medium (careful reading + rewriting)
**Risk:** Zero code risk — docs only

## Technical Details

- **Affected files:** `README.md`, `CLAUDE.md`, `docs/CHANGELOG.md`, `.env.example`

## Acceptance Criteria

- [ ] README version badge matches `backend/package.json` version
- [ ] Tool count is 10 everywhere (or "10 specialized tools")
- [ ] `getImpactAnalysis` is listed in the tools table with its parameters
- [ ] Tech stack table references `@modelcontextprotocol/sdk` and Vercel AI SDK, not Mastra
- [ ] Env var documentation matches `config/env.ts` exactly
- [ ] CLAUDE.md Gotchas reflect actual transport class (`SSEServerTransport`)
- [ ] CLAUDE.md infra.ts description matches actual exports
- [ ] CHANGELOG.md has a v2.1.0 entry

## Work Log

- 2026-03-06: Found by architecture-strategist + simplicity reviewer + TypeScript reviewer agents
