import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "./client";
import { sql } from "drizzle-orm";

// drizzle-kit が管理できない PL/pgSQL trigger を別 dir に分離して適用する。
// drizzle/0001_user_revision.sql 等の auto-managed migration は drizzle-kit migrate が処理する。
const manualDir = join(import.meta.dir, "..", "drizzle", "manual");

if (!existsSync(manualDir)) {
  console.log("[migrate-manual] drizzle/manual/ not found, skip.");
  process.exit(0);
}

const files = readdirSync(manualDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("[migrate-manual] no manual SQL files, skip.");
  process.exit(0);
}

// PostgreSQL の DDL は transaction 内で rollback 可能なため、複数 file の部分適用を防ぐ。
// 将来 drizzle/manual/0002_*.sql が追加された時に「0001 成功 / 0002 失敗」で停止しないことを保証。
await db.transaction(async (tx) => {
  for (const f of files) {
    const content = readFileSync(join(manualDir, f), "utf-8");
    console.log(`[migrate-manual] applying ${f}...`);
    await tx.execute(sql.raw(content));
  }
});

console.log(`[migrate-manual] applied ${files.length} file(s).`);
process.exit(0);
