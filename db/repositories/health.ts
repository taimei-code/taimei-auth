import { sql } from "drizzle-orm";
import { db } from "../client";

// /health 用の最小 query。drizzle を漏らさないため `SELECT 1` を repository に閉じる (db/CLAUDE.md ルール 1)。
export async function pingDatabase(): Promise<boolean> {
  return db
    .execute(sql`SELECT 1`)
    .then(() => true)
    .catch(() => false);
}
