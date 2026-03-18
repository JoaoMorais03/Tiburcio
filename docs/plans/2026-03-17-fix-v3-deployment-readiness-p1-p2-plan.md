---
title: Fix All P1/P2 Findings for v3 Open-Source Deployment
type: fix
status: active
date: 2026-03-17
---

# Fix All P1/P2 Findings for v3 Open-Source Deployment

## Overview

Address all 20 findings (6 P1, 14 P2) from the 8-agent deep review before open-source release. After fixing, re-run full analysis to verify 0 P1/P2 remain.

## Phase 1: Documentation Fixes (P1 — blocks release)

Fast, low-risk changes. All documentation updates in one pass.

### 1.1 Update "10 tools" → "12 tools" everywhere

- [ ] `README.md` — lines 26, 65, 187, 203, 273 + add `getFileContext` and `validateCode` to tool table (line 205-216)
- [ ] `CLAUDE.md` — lines 57, 141, 176
- [ ] `docs/CONTRIBUTING.md` — line 36

### 1.2 Remove company-specific docs

- [ ] Delete `docs/ProzisSetup.md`
- [ ] Delete `docs/ProzisTiburcioPod.md`

### 1.3 Add CHANGELOG v3 entry

- [ ] `docs/CHANGELOG.md` — add v3 section with: getFileContext, validateCode, MCP Instructions, response caching, REVIEW_MODEL, tool titles, architecture purity (nightly-review inline tools)

### 1.4 Add open-source metadata to package.json files

- [ ] Root `package.json` — add `description`, `author`, `license`, `repository`, `keywords`
- [ ] `backend/package.json` — add `description`, `author`, `license`, `repository`, `keywords`
- [ ] `frontend/package.json` — add `description`, `author`, `license`, `repository`, `keywords`

### 1.5 Fix SECURITY.md version table

- [ ] Update supported version from `2.1.x` to current version

## Phase 2: Code Parity Fix (P1)

### 2.1 Add 3 missing tools to web chat

- [ ] `backend/src/routes/chat.ts` — import and add `getFileContextTool`, `validateCodeTool`, `getImpactAnalysisTool` to the `tools` object (~lines 129-141)
- [ ] `backend/src/routes/chat.ts` — update `CHAT_SYSTEM_PROMPT` with usage guidance for these 3 tools

## Phase 3: Security Hardening (P2)

### 3.1 CSRF double-submit cookie

- [ ] Create `backend/src/middleware/csrf.ts` — middleware that:
  - On login/refresh response: sets non-httpOnly `csrf-token` cookie with random value
  - On non-GET `/api/*` routes: verifies `X-CSRF-Token` header matches cookie
  - Exempts `/mcp` routes (Bearer auth, not cookies)
- [ ] Wire into `server.ts` middleware stack
- [ ] Update `frontend/src/lib/api.ts` to read `csrf-token` cookie and send `X-CSRF-Token` header

### 3.2 Redis authentication

- [ ] `docker-compose.yml` — add `command: redis-server --requirepass ${REDIS_PASSWORD:-tiburcio-dev}` to Redis service
- [ ] `.env.example` — add `REDIS_PASSWORD` with documentation
- [ ] Verify `REDIS_URL` format in `.env.example` includes password slot: `redis://:${REDIS_PASSWORD}@redis:6379`

### 3.3 TEAM_API_KEY minimum strength

- [ ] `backend/src/config/env.ts` — change `TEAM_API_KEY` from `z.string().optional()` to `z.string().min(32).optional()`
- [ ] Update `.env.example` with a note about 32-char minimum

## Phase 4: Code Quality (P2)

### 4.1 Version string — single source of truth

- [ ] `backend/src/config/version.ts` — create: `import pkg from "../../package.json" assert { type: "json" }; export const VERSION = pkg.version;`
  - If JSON import assertion fails in ESM, use `createRequire` to load package.json
- [ ] `backend/src/server.ts` — import `VERSION` from config, replace hardcoded `"2.2.0"`
- [ ] `backend/src/mcp.ts` — import `VERSION`, replace hardcoded `"2.2.0"`
- [ ] `backend/src/routes/mcp.ts` — import `VERSION`, replace hardcoded `"2.2.0"`

### 4.2 Extract shared processFile pipeline

- [ ] `backend/src/indexer/index-codebase.ts` — export `processFileChunks(filePath, content, repoName, codebasePath)` that handles: chunk → link headers → contextualize → embed → build points → upsert
- [ ] `backend/src/mastra/workflows/nightly-review.ts` — replace `incrementalReindex` inline pipeline with call to shared `processFileChunks()`

### 4.3 Add caching to getTestSuggestions

- [ ] `backend/src/mastra/tools/get-test-suggestions.ts` — add `cacheGet`/`cacheSet` following the same pattern as `search-standards.ts` (60s TTL)

### 4.4 MCP_INSTRUCTIONS improvements

- [ ] `backend/src/mcp-tools.ts` — add to `MCP_INSTRUCTIONS`:
  - "All search tools default to compact:true (3 results, truncated). Set compact:false for full results when initial results are insufficient."
  - "If a response includes source:'git-log', the nightly pipeline hasn't run yet — results are raw git data, not AI-reviewed."

## Phase 5: Configuration & Docs Cleanup (P2)

### 5.1 Fix .env.example

- [ ] Change `MODEL_PROVIDER=openai-compatible` to `MODEL_PROVIDER=ollama` (match README Quick Start default)
- [ ] Add missing env vars: `REVIEW_MODEL`, `RETRIEVAL_CONFIDENCE_THRESHOLD`, `RETRIEVAL_CODE_SCORE_THRESHOLD`, `LANGFUSE_RECORD_IO`

### 5.2 Fix README inconsistencies

- [ ] Update roadmap section (line ~436) — remove stale v2 roadmap items, point to current state
- [ ] Fix MCP SSE URL example — change port 3000 to 3333 for Docker deployments

### 5.3 Extract shared findSourceFiles

- [ ] Move `loadTibignorePatterns`, `findSourceFiles`, `SKIP_DIRS`, `SOURCE_EXTENSIONS`, `BLOCKED_FILE_PATTERNS` from `index-codebase.ts` into `indexer/fs.ts`
- [ ] Update `index-codebase.ts` and `graph/builder.ts` to import from `indexer/fs.ts`

### 5.4 Add tests for v3 tools

- [ ] `backend/src/__tests__/validate-code.test.ts` — test `parseViolations` (bare JSON, fenced JSON, malformed), `executeValidateCode` (standards found, no standards, LLM error)
- [ ] `backend/src/__tests__/get-file-context.test.ts` — test `executeGetFileContext` (conventions + reviews + patterns aggregated, partial failures handled)
- [ ] `backend/src/__tests__/detect.test.ts` — test `detectLanguage`, `detectLayer`, `isKnownLanguage`

### 5.5 Clean todos/ directory

- [ ] Remove or `.gitignore` the `todos/` directory (internal development artifacts, not for open-source consumers)

### 5.6 Update CLAUDE.md for v3

- [ ] Update all "10 tools" references to "12 tools"
- [ ] Add `cache.ts`, `detect.ts`, `get-file-context.ts`, `validate-code.ts` to file layout
- [ ] Document `REVIEW_MODEL` env var and `getReviewModel()` in Architecture section
- [ ] Add MCP Instructions field to Architecture notes

### 5.7 Fix sequential git N+1 pattern

- [ ] `backend/src/indexer/git-diff.ts` — refactor `getFileDiffs` to use single `git diff commitSha^..commitSha` and parse combined output by file
- [ ] `backend/src/indexer/git-diff.ts` — consolidate `getMergeCommits` and `getRecentCommits` into shared helper with `mergesOnly` parameter

## Acceptance Criteria

- [ ] `pnpm check` passes in both backend/ and frontend/
- [ ] `pnpm test` passes in both backend/ and frontend/ (all existing + new tests)
- [ ] No P1 or P2 findings remain on full re-review
- [ ] README, CLAUDE.md, CHANGELOG, SECURITY.md, .env.example all reflect current v3 state
- [ ] No company-specific content in repository
- [ ] All 12 MCP tools documented and available in both MCP and web chat
- [ ] CSRF protection active on cookie-authenticated endpoints
- [ ] Zero hardcoded version strings

## Verification Loop

After all fixes:
1. Run `pnpm check && pnpm test` in backend/ and frontend/
2. Re-run full 8-agent review (security, performance, architecture, simplicity, TypeScript, agent-native, docs, patterns)
3. If any P1/P2 remain → fix and repeat
4. Done when 0 P1 and 0 P2
