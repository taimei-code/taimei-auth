import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { db } from "./client";
import { sql } from "drizzle-orm";
import type { DbTx } from "./transaction";

const manualDir = join(import.meta.dir, "..", "drizzle", "manual");

export async function applyManualSql(tx: DbTx): Promise<string[]> {
  const files = readdirSync(manualDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    console.log(`[migrate-manual] applying ${f}...`);
    await tx.execute(sql.raw(readFileSync(join(manualDir, f), "utf-8")));
  }
  return files;
}

if (import.meta.main) {
  const applied = await db.transaction(applyManualSql);
  console.log(`[migrate-manual] applied ${applied.length} file(s).`);
  process.exit(0);
}
