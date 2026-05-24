-- ADR-009: gen_random_bytes() を使うため pgcrypto extension を有効化する。
-- backfill SQL の ID 生成 (`translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_')`)
-- が pgcrypto に依存。drizzle-kit は CREATE EXTENSION を生成しないため drizzle/manual/ に分離。
CREATE EXTENSION IF NOT EXISTS pgcrypto;
