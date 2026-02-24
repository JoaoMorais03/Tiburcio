// indexer/redact.ts — Secret redaction to prevent leaks to OpenRouter API.

const SECRET_PATTERNS = [
  // Key/secret/password/token assignments
  {
    pattern: /(key|secret|password|token|apikey|api_key)\s*[:=]\s*["']([^"']+)["']/gi,
    replacement: "$1: [REDACTED]",
  },
  // Connection strings with credentials
  {
    pattern: /(postgres|mysql|mongodb|redis):\/\/([^:]+):([^@]+)@/gi,
    replacement: "$1://[REDACTED]@",
  },
  // Bearer tokens
  {
    pattern: /Bearer\s+[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+/gi,
    replacement: "Bearer [REDACTED]",
  },
  // AWS access keys
  {
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: "[REDACTED]",
  },
  // Generic base64-encoded secrets (40+ chars, likely tokens)
  {
    pattern: /["'][A-Za-z0-9+/]{40,}={0,2}["']/g,
    replacement: '"[REDACTED]"',
  },
  // Private keys
  {
    pattern:
      /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    replacement: "-----BEGIN PRIVATE KEY----- [REDACTED] -----END PRIVATE KEY-----",
  },
];

/** Redact common secret patterns before sending text to external APIs. */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}
