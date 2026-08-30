import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "./client";
import { sql } from "drizzle-orm";

// drizzle-kit が管理できない PL/pgSQL trigger を別 dir に分離して適用する (db/CLAUDE.md ルール 8)。
const manualDir = join(import.meta.dir, "..", "drizzle", "manual");

if (!existsSync(manualDir)) {
  console.log("[migrate-manual] drizzle/manual/ not found, skip.");
  process.exit(0);
}

const sqlFilesInApplyOrder = readdirSync(manualDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (sqlFilesInApplyOrder.length === 0) {
  console.log("[migrate-manual] no manual SQL files, skip.");
  process.exit(0);
}

// 複数 file の部分適用を防ぐため transaction 内に閉じる (PostgreSQL の DDL は rollback 可能)。
await db.transaction(async (tx) => {
  for (const f of sqlFilesInApplyOrder) {
    const content = readFileSync(join(manualDir, f), "utf-8");
    console.log(`[migrate-manual] applying ${f}...`);
    await tx.execute(sql.raw(content));
  }
});

console.log(`[migrate-manual] applied ${sqlFilesInApplyOrder.length} file(s).`);
process.exit(0);
