table: users
description: Application users with authentication credentials and role-based access. Passwords stored as bcrypt hashes. Supports user and admin roles.
relations: conversations (one-to-many via user_id)
indexes: username (unique)

# Users Table

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, default random |
| username | varchar(50) | unique, not null, 2-50 chars |
| password_hash | text | not null, bcrypt |
| role | enum(user, admin) | default: user |
| created_at | timestamp | default now() |
| updated_at | timestamp | default now() |

## Notes
- Passwords are hashed with bcrypt (12 salt rounds) before storage
- The `role` field controls access to admin endpoints (reindexing)
- Username uniqueness is enforced at the database level
- Cascade delete: deleting a user removes all their conversations and messages
