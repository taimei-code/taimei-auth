import { type SQL, sql } from "drizzle-orm";
import { db } from "../client";

const firstValue = async (query: SQL): Promise<string | null> =>
  (await db.execute<{ value: string }>(query)).rows[0]?.value ?? null;

const expiresAtOrNever = (ttlSec: number | undefined) =>
  sql`now() + make_interval(secs => ${ttlSec ?? null}::double precision)`;

const isLive = sql`(expires_at IS NULL OR expires_at > now())`;

export const postgresTtlStore = async () => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS testing_ttl_store (
      key text PRIMARY KEY,
      value text NOT NULL,
      expires_at timestamptz
    )`);
  await db.execute(sql`DELETE FROM testing_ttl_store WHERE NOT ${isLive}`);

  return {
    get: (key: string) =>
      firstValue(sql`SELECT value FROM testing_ttl_store WHERE key = ${key} AND ${isLive}`),
    set: async (key: string, value: string, ttlSec?: number): Promise<void> => {
      await db.execute(sql`
        INSERT INTO testing_ttl_store (key, value, expires_at)
        VALUES (${key}, ${value}, ${expiresAtOrNever(ttlSec)})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`);
    },
    delete: async (key: string): Promise<void> => {
      await db.execute(sql`DELETE FROM testing_ttl_store WHERE key = ${key}`);
    },
    getAndDelete: (key: string) =>
      firstValue(sql`
        WITH deleted AS (DELETE FROM testing_ttl_store WHERE key = ${key} RETURNING value, expires_at)
        SELECT value FROM deleted WHERE ${isLive}`),
    mergeSessionIndex: async (key: string, value: string): Promise<void> => {
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO testing_ttl_store (key, value, expires_at) VALUES (${key}, '[]', now())
          ON CONFLICT (key) DO NOTHING`);
        const stored = (
          await tx.execute<{ value: string; live: boolean }>(sql`
            SELECT value, ${isLive} AS live FROM testing_ttl_store WHERE key = ${key} FOR UPDATE`)
        ).rows[0];
        const merged = mergeSessionIndex(stored?.live ? stored.value : null, value, Date.now());
        await tx.execute(sql`
          UPDATE testing_ttl_store
          SET value = ${merged.value}, expires_at = ${expiresAtOrNever(merged.ttlSeconds)}
          WHERE key = ${key}`);
      });
    },
    incrementRateWindow: async (key: string, windowSec: number) => {
      const count = Number(
        await firstValue(sql`
          INSERT INTO testing_ttl_store AS stored (key, value, expires_at)
          VALUES (${key}, '1', ${expiresAtOrNever(windowSec)})
          ON CONFLICT (key) DO UPDATE SET
            value = CASE WHEN stored.expires_at IS NULL OR stored.expires_at > now()
              THEN (stored.value::bigint + 1)::text ELSE '1' END,
            expires_at = excluded.expires_at
          RETURNING value`),
      );
      if (!Number.isInteger(count) || count < 1) {
        throw new Error(`incrementRateWindow: count is not a positive integer (${count})`);
      }
      return { count };
    },
    ping: async (): Promise<void> => {
      await db.execute(sql`SELECT 1`);
    },
  };
};
