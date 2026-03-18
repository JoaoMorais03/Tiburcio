# Requirements Document — Tiburcio V3.0.0 Production Deployment

## Introduction

This specification defines the requirements for shipping Tiburcio V3.0.0 to production. The current version (2.2.0) has 171 passing tests and includes two V3 tools (`getFileContext` and `validateCode`) that are implemented but not yet exposed via MCP. This release focuses on production readiness: registering V3 tools in MCP, implementing security hardening (CSRF protection, credential validation), eliminating architectural duplication (dual tool definitions), and ensuring complete documentation.

The goal is to ship a production-grade MCP server with 12 tools (10 existing + 2 V3 tools), zero breaking changes for existing users, and enterprise-ready security posture.

## Glossary

- **MCP**: Model Context Protocol — the interface through which Claude Code calls Tiburcio tools
- **V3 Tools**: `getFileContext` and `validateCode` — context bundle and active validation tools
- **CSRF**: Cross-Site Request Forgery — attack vector for cookie-based authentication
- **AI SDK Tool**: Tool definition format used by Vercel AI SDK for agentic workflows
- **MCP Tool**: Tool definition format used by MCP server for Claude Code integration
- **Dual Tool Definitions**: Current architecture where each tool is defined twice (AI SDK + MCP)
- **Nightly Pipeline**: Background job that reviews code merges and generates test suggestions
- **Default Credentials**: Placeholder passwords in `.env.example` that must be changed in production
- **Bearer Token**: Authentication method for MCP HTTP/SSE transport via `TEAM_API_KEY`
- **Response Cache**: In-memory TTL cache for tool results to reduce redundant queries
- **Tiburcio**: The system being deployed — developer intelligence MCP server
- **Backend**: Node.js/Hono HTTP server that hosts MCP tools and API endpoints
- **Frontend**: Vue 3 chat UI for interacting with Tiburcio via web browser

## Requirements

### Requirement 1: MCP Tool Registration for V3 Tools

**User Story:** As a developer using Claude Code with Tiburcio MCP, I want to call `getFileContext` and `validateCode` via MCP, so that I can get complete file context and validate code against team standards without switching tools.

#### Acceptance Criteria

1. WHEN Claude Code calls `getFileContext` via MCP, THE Backend SHALL return conventions, recent review findings, dependency information, and applicable patterns for the specified file path
2. WHEN Claude Code calls `validateCode` via MCP, THE Backend SHALL validate the provided code against indexed team conventions and return structured violations
3. THE Backend SHALL register both V3 tools in `mcp-tools.ts` with the same schema and annotations as existing tools
4. THE Backend SHALL expose both V3 tools via stdio transport (`mcp.ts`) and HTTP/SSE transport (`routes/mcp.ts`)
5. WHEN a V3 tool is called, THE Backend SHALL trace the call via Langfuse if observability is configured
6. THE Backend SHALL include both V3 tools in the MCP server's tool list response

### Requirement 2: CSRF Protection for Cookie-Based Authentication

**User Story:** As a security-conscious team lead, I want CSRF protection on all authenticated endpoints, so that malicious sites cannot make cross-origin requests using my team's session cookies.

#### Acceptance Criteria

1. WHEN a user logs in successfully, THE Backend SHALL set a non-httpOnly `csrf-token` cookie with a random UUID value
2. WHEN a user makes a non-GET request to any `/api/*` endpoint (except `/api/auth/login` and `/api/auth/register`), THE Backend SHALL verify that the `X-CSRF-Token` header matches the `csrf-token` cookie value
3. IF the CSRF token is missing or mismatched, THEN THE Backend SHALL return HTTP 403 with error message "CSRF token validation failed"
4. THE Backend SHALL NOT apply CSRF validation to `/mcp` routes (Bearer token authentication, not cookies)
5. THE Backend SHALL NOT apply CSRF validation to GET requests (read-only, no state mutation)
6. THE Frontend SHALL read the `csrf-token` cookie and attach it as the `X-CSRF-Token` header on all API requests
7. WHEN a user logs out, THE Backend SHALL clear the `csrf-token` cookie

### Requirement 3: Production Credential Validation

**User Story:** As a DevOps engineer deploying Tiburcio to production, I want the system to warn me if I'm using default credentials, so that I don't accidentally deploy with insecure passwords.

#### Acceptance Criteria

1. WHEN THE Backend starts in production mode (`NODE_ENV=production`), THE Backend SHALL check if `JWT_SECRET` matches the default value from `.env.example`
2. WHEN THE Backend starts in production mode AND `JWT_SECRET` is a default value, THE Backend SHALL log a WARNING message: "Production deployment detected with default JWT_SECRET — change immediately"
3. WHEN THE Backend starts in production mode, THE Backend SHALL check if `POSTGRES_PASSWORD` matches the default value from `.env.example`
4. WHEN THE Backend starts in production mode AND `POSTGRES_PASSWORD` is a default value, THE Backend SHALL log a WARNING message: "Production deployment detected with default POSTGRES_PASSWORD — change immediately"
5. WHEN THE Backend starts in production mode AND `TEAM_API_KEY` is not set, THE Backend SHALL log a WARNING message: "TEAM_API_KEY not configured — MCP HTTP/SSE transport will return 503"
6. THE Backend SHALL NOT prevent startup when default credentials are detected (warn only, not fail)

### Requirement 4: Single Source of Truth for Tool Definitions

**User Story:** As a maintainer of Tiburcio, I want tool schemas defined in one place only, so that I don't have to update two files every time I change a tool parameter or description.

#### Acceptance Criteria

1. THE Backend SHALL define all MCP tool schemas, descriptions, and parameters in `mcp-tools.ts` only
2. THE Backend SHALL NOT export AI SDK tool objects from individual tool files in `mastra/tools/`
3. THE Backend SHALL define AI SDK tools inline in `nightly-review.ts` using the `tool()` wrapper around execute functions
4. WHEN a tool schema changes, THE Backend SHALL require updates only in `mcp-tools.ts` (for MCP) and `nightly-review.ts` (for AI SDK usage)
5. THE Backend SHALL export only `executeFoo()` functions from tool files (no `fooTool` exports)
6. THE Backend SHALL maintain backward compatibility — all existing tool execute functions SHALL continue to work unchanged

### Requirement 5: Response Caching for Repeated Queries

**User Story:** As a developer using Claude Code, I want repeated tool calls to return faster, so that I don't wait 2-3 seconds for the same query I just made.

#### Acceptance Criteria

1. WHEN a tool is called with identical parameters within the cache TTL window, THE Backend SHALL return the cached result without re-querying Qdrant or re-embedding
2. THE Backend SHALL cache `searchStandards`, `getArchitecture`, and `searchSchemas` results for 300 seconds (5 minutes)
3. THE Backend SHALL cache `searchCode` and `searchReviews` results for 60 seconds (1 minute)
4. THE Backend SHALL NOT cache `getFileContext`, `validateCode`, `getNightlySummary`, `getChangeSummary`, `getTestSuggestions`, or `getImpactAnalysis` (dynamic or LLM-dependent results)
5. WHEN any indexing job completes, THE Backend SHALL clear all cached entries
6. THE Backend SHALL limit the cache to 500 entries maximum with FIFO eviction
7. THE Backend SHALL generate cache keys from tool name and sorted parameter JSON

### Requirement 6: MCP Endpoint Rate Limiting

**User Story:** As a team lead deploying Tiburcio for shared use, I want rate limiting on the MCP HTTP/SSE endpoint, so that a single developer's runaway script doesn't exhaust server resources.

#### Acceptance Criteria

1. THE Backend SHALL apply a dedicated rate limiter to all `/mcp` routes
2. THE Backend SHALL allow 60 requests per minute per IP address on `/mcp` routes
3. WHEN the rate limit is exceeded, THE Backend SHALL return HTTP 429 with a `Retry-After` header
4. THE Backend SHALL NOT apply the global `/api/*` rate limiter to `/mcp` routes (separate limit)
5. THE Backend SHALL NOT apply the chat-specific rate limiter to `/mcp` routes

### Requirement 7: Documentation Updates for V3.0.0

**User Story:** As a new user evaluating Tiburcio, I want the README and documentation to accurately reflect the current feature set, so that I know what tools are available and how to use them.

#### Acceptance Criteria

1. THE README SHALL list 12 MCP tools in the tools table (10 existing + `getFileContext` + `validateCode`)
2. THE README SHALL include descriptions of `getFileContext` and `validateCode` with usage guidance
3. THE README SHALL document the CSRF protection mechanism in the security section
4. THE README SHALL warn users to change default credentials in production
5. THE CLAUDE.md SHALL document both V3 tools with parameter schemas and return types
6. THE CLAUDE.md SHALL document the CSRF middleware and token flow
7. THE CLAUDE.md SHALL document the single-source-of-truth architecture for tool definitions
8. THE CLAUDE.md SHALL update the version number to 3.0.0
9. THE CHANGELOG SHALL include a v3.0.0 section with all new features, security improvements, and breaking changes (if any)
10. THE Backend `server.ts` SHALL report version "3.0.0" in startup logs
11. THE Backend `mcp.ts` SHALL report version "3.0.0" in MCP server info
12. THE Backend `package.json` SHALL have version "3.0.0"
13. THE Frontend `package.json` SHALL have version "3.0.0"

### Requirement 8: Backward Compatibility and Zero Breaking Changes

**User Story:** As an existing Tiburcio user on v2.2.0, I want to upgrade to v3.0.0 without changing my MCP client configuration or tool call patterns, so that the upgrade is seamless.

#### Acceptance Criteria

1. THE Backend SHALL maintain all 10 existing MCP tool names, parameters, and response formats unchanged
2. THE Backend SHALL NOT remove or rename any existing tool parameters
3. THE Backend SHALL NOT change the authentication mechanism for MCP HTTP/SSE transport (Bearer token via `TEAM_API_KEY`)
4. THE Backend SHALL NOT change the authentication mechanism for `/api/*` endpoints (httpOnly cookie JWT)
5. THE Backend SHALL NOT require any new mandatory environment variables (all new vars must be optional with sensible defaults)
6. WHEN a v2.2.0 MCP client connects to v3.0.0, THE Backend SHALL respond successfully to all existing tool calls
7. THE Backend SHALL maintain the same MCP transport protocols (stdio and HTTP/SSE)

### Requirement 9: Production Deployment Validation

**User Story:** As a DevOps engineer, I want to verify that Tiburcio v3.0.0 deploys successfully via Docker Compose, so that I can confidently roll it out to production.

#### Acceptance Criteria

1. WHEN `docker compose up -d --build` is executed, THE Backend SHALL build successfully without errors
2. WHEN all services are started, THE Backend SHALL pass all health checks within 60 seconds
3. WHEN the Backend starts for the first time, THE Backend SHALL run database migrations automatically
4. WHEN the Backend starts with empty Qdrant collections, THE Backend SHALL queue auto-indexing jobs for configured collections
5. THE Backend SHALL start successfully with only required environment variables set (`DATABASE_URL`, `JWT_SECRET`)
6. THE Backend SHALL start successfully with Ollama as the model provider (default, no API key required)
7. THE Backend SHALL log clear startup messages indicating which services are configured (Neo4j, Langfuse, MCP HTTP/SSE)

### Requirement 10: Test Coverage for New Features

**User Story:** As a maintainer of Tiburcio, I want comprehensive test coverage for all new v3.0.0 features, so that regressions are caught before deployment.

#### Acceptance Criteria

1. THE Backend SHALL include tests for CSRF middleware (valid token passes, missing token fails, mismatched token fails, GET requests exempt, `/mcp` routes exempt)
2. THE Backend SHALL include tests for production credential validation (default JWT_SECRET logs warning, default POSTGRES_PASSWORD logs warning, missing TEAM_API_KEY logs warning)
3. THE Backend SHALL include tests for response cache (cache hit returns cached result, cache miss queries Qdrant, TTL expiry invalidates cache, cache clear removes all entries, FIFO eviction at max capacity)
4. THE Backend SHALL include tests for MCP rate limiting (requests under limit succeed, requests over limit return 429)
5. THE Backend SHALL include tests for `getFileContext` MCP registration (tool is listed, tool call returns expected structure)
6. THE Backend SHALL include tests for `validateCode` MCP registration (tool is listed, tool call returns expected structure)
7. WHEN all tests are run via `pnpm test`, THE Backend SHALL have at least 200 passing tests (171 existing + ~30 new)
8. WHEN all tests are run, THE Backend SHALL have zero failing tests
9. WHEN `pnpm check` is run in backend/, THE Backend SHALL pass Biome linting and TypeScript type checking
10. WHEN `pnpm check` is run in frontend/, THE Frontend SHALL pass Biome linting and Vue type checking

### Requirement 11: Security Headers and Hardening

**User Story:** As a security engineer, I want Tiburcio to set standard security headers on all HTTP responses, so that common web vulnerabilities are mitigated.

#### Acceptance Criteria

1. THE Backend SHALL set `X-Content-Type-Options: nosniff` on all HTTP responses
2. THE Backend SHALL set `X-Frame-Options: DENY` on all HTTP responses
3. THE Backend SHALL set `Referrer-Policy: strict-origin-when-cross-origin` on all HTTP responses
4. THE Backend SHALL set `Strict-Transport-Security` header when served over HTTPS
5. THE Backend SHALL NOT expose internal error stack traces in production mode (`NODE_ENV=production`)
6. THE Backend SHALL log all authentication failures (login, token refresh, CSRF validation) at WARN level
7. THE Backend SHALL redact secrets from all logs (API keys, passwords, tokens)

### Requirement 12: Graceful Degradation for Optional Services

**User Story:** As a developer deploying Tiburcio without Neo4j or Langfuse, I want the system to work without these optional services, so that I can start with a minimal setup and add services later.

#### Acceptance Criteria

1. WHEN `NEO4J_URI` is not set, THE Backend SHALL start successfully and `getImpactAnalysis` SHALL return `{ available: false }`
2. WHEN `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are not set, THE Backend SHALL start successfully and all tool calls SHALL work without tracing
3. WHEN `TEAM_API_KEY` is not set, THE Backend SHALL start successfully and `/mcp` routes SHALL return HTTP 503 with message "MCP HTTP/SSE transport not configured"
4. WHEN Qdrant is unavailable at startup, THE Backend SHALL retry connection 3 times with exponential backoff before failing
5. WHEN Redis is unavailable at startup, THE Backend SHALL retry connection 3 times with exponential backoff before failing
6. WHEN PostgreSQL is unavailable at startup, THE Backend SHALL fail fast with a clear error message (required service)

