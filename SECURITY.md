# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.2.x   | Yes       |
| 1.1.x   | No        |
| 1.0.x   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in Tiburcio, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **security@tiburcio.dev** (or open a [private security advisory](https://github.com/JoaoMorais03/tiburcio/security/advisories/new) on GitHub).

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix release**: As soon as practical, typically within 2 weeks for critical issues

## Security Measures

Tiburcio implements the following security practices:

- **Authentication**: httpOnly cookie JWT (HS256) with refresh token rotation
- **Password hashing**: bcrypt with salt rounds
- **Input sanitization**: DOMPurify on all rendered markdown
- **Rate limiting**: Global, auth, and chat rate limiters via Redis
- **Secret redaction**: API keys and credentials stripped before indexing
- **CORS**: Configurable allowed origins
- **Environment validation**: Zod schema validation on startup
- **Non-root containers**: Docker images run as unprivileged user (UID 1001)
- **Dependency pinning**: Frozen lockfile enforcement in CI

## Best Practices for Deployment

1. **Change all default credentials** before deploying to production
2. Set a strong `JWT_SECRET` (min 32 characters): `openssl rand -base64 32`
3. Restrict `CORS_ORIGINS` to your actual domains
4. Use a reverse proxy (nginx, Caddy) with TLS in production
5. Keep dependencies updated — Dependabot is configured for automated PRs
6. Review the `CODEBASE_REPOS` setting — only index repositories you trust
