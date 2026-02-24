// Tests for secret redaction utility.

import { describe, expect, it } from "vitest";

import { redactSecrets } from "../indexer/redact.js";

describe("redactSecrets", () => {
  it("redacts key/secret/password/token assignments", () => {
    const input = `const apiKey = "sk-12345abcdef";\nconst password: "hunter2"`;
    const result = redactSecrets(input);
    expect(result).toContain("apiKey: [REDACTED]");
    expect(result).toContain("password: [REDACTED]");
    expect(result).not.toContain("sk-12345abcdef");
    expect(result).not.toContain("hunter2");
  });

  it("redacts database connection strings with credentials", () => {
    const input = "postgres://admin:secretpass@db.example.com:5432/mydb";
    const result = redactSecrets(input);
    expect(result).toBe("postgres://[REDACTED]@db.example.com:5432/mydb");
    expect(result).not.toContain("admin");
    expect(result).not.toContain("secretpass");
  });

  it("redacts bearer tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature";
    const result = redactSecrets(input);
    expect(result).toBe("Authorization: Bearer [REDACTED]");
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  });

  it("redacts AWS access keys", () => {
    const input = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("redacts long base64-like secrets (40+ chars)", () => {
    const input = `const token = "dGhpc2lzYXZlcnlsb25nc2VjcmV0dG9rZW50aGF0c2hvdWxkYmVyZWRhY3RlZA==";`;
    const result = redactSecrets(input);
    expect(result).toContain("token: [REDACTED]");
    expect(result).not.toContain(
      "dGhpc2lzYXZlcnlsb25nc2VjcmV0dG9rZW50aGF0c2hvdWxkYmVyZWRhY3RlZA==",
    );
  });

  it("redacts private keys", () => {
    const input = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xNz1vJEfSGCFU3k0Hke20IWQOLpWDWd/mdbN
-----END RSA PRIVATE KEY-----`;
    const result = redactSecrets(input);
    expect(result).toContain("-----BEGIN PRIVATE KEY----- [REDACTED] -----END PRIVATE KEY-----");
    expect(result).not.toContain("MIIEpAIBAAKCAQEA0Z3VS5JJcds3xNz1vJEfSGCFU3k0Hke20IWQOLpWDWd");
  });

  it("leaves normal code unchanged", () => {
    const input = `function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}`;
    const result = redactSecrets(input);
    expect(result).toBe(input);
  });

  it("handles mixed content with secrets and normal code", () => {
    const input = `const config = {
  apiKey: "sk-proj-abc123",
  timeout: 5000,
  retries: 3
};`;
    const result = redactSecrets(input);
    expect(result).toContain("apiKey: [REDACTED]");
    expect(result).toContain("timeout: 5000");
    expect(result).toContain("retries: 3");
    expect(result).not.toContain("sk-proj-abc123");
  });

  it("redacts multiple secrets in one string", () => {
    const input = `
      const dbUrl = "postgres://user:pass@localhost/db";
      const apiToken = "Bearer eyJhbGci.payload.sig";
      const awsKey = "AKIAIOSFODNN7EXAMPLE";
    `;
    const result = redactSecrets(input);
    expect(result).toContain("postgres://[REDACTED]@localhost/db");
    expect(result).toContain("apiToken: [REDACTED]");
    expect(result).toContain("awsKey: [REDACTED]");
    expect(result).not.toContain("user:pass");
    expect(result).not.toContain("eyJhbGci.payload.sig");
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});
