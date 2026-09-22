-- ADR-009 に基づき、gen_random_bytes() を使うため pgcrypto extension を有効にする。
-- backfill SQL の ID 生成 (`translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_')`)
-- が pgcrypto に依存する。drizzle-kit は CREATE EXTENSION を生成しないため drizzle/manual/ に分けて置く。
CREATE EXTENSION IF NOT EXISTS pgcrypto;
