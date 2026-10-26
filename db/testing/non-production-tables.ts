import { sql } from "drizzle-orm";
import { db } from "../client";
import { seedDevAccounts } from "./dev-accounts";
import type { LocalDatabase } from "./local-database";

export const prepareNonProductionTables = async (_database: LocalDatabase) => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS testing_browser_account (
      browser_key text NOT NULL,
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (browser_key, user_id)
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS testing_ttl_store (
      key text PRIMARY KEY,
      value text NOT NULL,
      expires_at timestamptz
    )`);
  await seedDevAccounts();
};
