// Shared types for MCP tool files.

export interface SearchResult {
  score?: number;
  payload?: Record<string, unknown> | null;
}
