import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Workers (workerd) は process レベルの永続接続を持てないため、DB クライアントを module ロード時
// ではなく初回リクエスト時に env から 1 度だけ構築する。ESM の live binding により、
// import { db } 側 (repository 群 / transaction.ts) は initDb 後の値を参照する。
// Bun / Node (compose / テスト / CLI script) は module ロード時に process.env.DATABASE_URL から
// 自動 init して従来挙動を保つ。
// 設計詳細: docs/adr/0011-cloudflare-workers-migration.md
export let db: NodePgDatabase<typeof schema>;

let pool: Pool | undefined;

// Hyperdrive(本番) / DATABASE_URL(local) いずれの接続文字列でも構築可能。
// drizzle-orm/node-postgres の Pool は Workers では Hyperdrive binding が供給する
// connectionString 経由で接続する (interactive tx / advisory lock は ADR-0011 で接地確認済み)。
export function initDb(connectionString: string): void {
  if (pool) return;
  pool = new Pool({ connectionString });
  db = drizzle(pool, { schema });
}

// Bun / Node: 接続文字列が env にあれば即 init。Workers では DATABASE_URL が未設定のため skip し、
// worker entry (src/worker.ts) が env.HYPERDRIVE.connectionString で initDb する。
if (typeof process !== "undefined" && process.env?.DATABASE_URL) {
  initDb(process.env.DATABASE_URL);
}
