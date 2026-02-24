table: conversations
description: Chat conversations between users and the AI agent. Each conversation has a title auto-generated from the first message. Messages are ordered by creation time.
relations: users (many-to-one via user_id), messages (one-to-many)
indexes: user_id + updated_at (composite, for fast listing)

# Conversations Table

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, default random |
| user_id | uuid | FK → users(id), cascade delete |
| title | text | nullable, auto-set from first message |
| created_at | timestamp | default now() |
| updated_at | timestamp | default now() |

## Notes
- Title is the first 50 characters of the user's first message
- Composite index on `(user_id, updated_at DESC)` for paginated conversation listing
- Deleting a conversation cascades to all its messages
