table: messages
description: Individual messages within a conversation. Each message has a role (user or assistant) and text content. Messages are immutable once created.
relations: conversations (many-to-one via conversation_id)
indexes: conversation_id

# Messages Table

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, default random |
| conversation_id | uuid | FK → conversations(id), cascade delete |
| role | enum(user, assistant) | not null |
| content | text | not null |
| created_at | timestamp | default now() |

## Notes
- Messages are append-only (no updates or deletes on individual messages)
- The `role` field distinguishes between user input and AI responses
- Index on `conversation_id` for fast message retrieval per conversation
- Messages are ordered by `created_at` when displayed
