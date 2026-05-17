import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "./client";
import { sql } from "drizzle-orm";

// ADR-001 R1 + MECE I7: drizzle-kit が管理できない PL/pgSQL trigger を別 dir に分離して適用する。
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

for (const f of files) {
  const content = readFileSync(join(manualDir, f), "utf-8");
  console.log(`[migrate-manual] applying ${f}...`);
  await db.execute(sql.raw(content));
}

console.log(`[migrate-manual] applied ${files.length} file(s).`);
process.exit(0);
