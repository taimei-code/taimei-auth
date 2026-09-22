-- 0003 の gen_random_bytes() に要る。drizzle-kit は CREATE EXTENSION を生成しないため manual に置く
CREATE EXTENSION IF NOT EXISTS pgcrypto;
