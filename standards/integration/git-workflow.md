# Git Workflow

Our team follows a trunk-based development workflow with short-lived feature branches. Tiburcio's nightly pipeline monitors merges to `develop` and automatically reviews them against our conventions.

## Branch Naming

All branches follow this format: `<type>/<short-description>`

Types:
- `feat/` — New features (`feat/add-search-filter`)
- `fix/` — Bug fixes (`fix/login-redirect`)
- `refactor/` — Code refactoring (`refactor/auth-middleware`)
- `docs/` — Documentation changes (`docs/api-readme`)
- `chore/` — Maintenance tasks (`chore/update-deps`)

## Commit Messages

We use Conventional Commits. Every commit message follows this format:

```
<type>(<scope>): <description>

[optional body]
```

Examples:
- `feat(chat): add streaming response support`
- `fix(db): handle null embeddings in similarity search`
- `refactor(routes): extract validation middleware`
- `docs(readme): add setup instructions`

Keep descriptions under 72 characters. Use imperative mood ("add" not "added").

## Pull Request Process

1. Create a branch from `main`
2. Make your changes with clear, atomic commits
3. Push and open a PR with a descriptive title (same format as commits)
4. Fill in the PR template: what changed, why, how to test
5. Request review from at least one team member
6. Address review feedback with new commits (don't force-push during review)
7. Squash merge into `main` once approved

## Code Review Guidelines

When reviewing:
- Check for correctness, readability, and edge cases
- Verify TypeScript types are accurate (no `any` unless justified)
- Ensure error handling is present
- Look for potential performance issues
- Run the code locally if the change is significant

When receiving review:
- Respond to every comment (even just "done")
- Ask questions if feedback is unclear
- Don't take it personally — reviews improve the code

## Nightly Automated Review

In addition to human code review, Tiburcio's nightly pipeline automatically reviews all merges to `develop` from the previous day:

1. **What it checks**: Convention violations, potential bugs, missing error handling, security concerns, and noteworthy patterns — all grounded in the team's standards collection (not generic rules).
2. **Where results go**: Review insights are embedded and stored in the Qdrant `reviews` collection. The onboarding agent can retrieve them via the `searchReviews` tool.
3. **How to use it**: Ask Tiburcio (chat UI or MCP) "what changed in auth this week?" or "any issues from yesterday's merges?" to get review insights. Ask "let's write tests for yesterday's merges" to get test suggestions grounded in your team's patterns.
4. **Convention scoring**: Each merge gets an adherence score. Trends are tracked over time so the team can spot convention drift early.

The automated review supplements human review — it doesn't replace it. Its primary value is making review insights searchable for onboarding and keeping the team aware of convention adherence.

## Deployment

We deploy from `main` automatically. Every merge to `main` triggers:
1. Linting and type checking
2. Test suite
3. Build
4. Deploy to staging
5. Manual promotion to production after QA

Never push directly to `main`. Always go through a PR.
